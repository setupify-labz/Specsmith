// Windows hardware/environment detection.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It does not guess. Every field below is either read from the machine or
// reported as a gap for the operator to supply, and the observation records
// which happened. A guessed RAM channel count is indistinguishable from a
// detected one once it is in the store, and that is precisely the kind of
// quiet fabrication this project exists to avoid.
//
// Known limits on Windows, all surfaced rather than papered over:
//
//   RAM channel count   Win32_PhysicalMemory exposes DIMM slots via
//                       BankLabel/DeviceLocator, but mapping those to physical
//                       channels is motherboard-specific. NOT detected.
//   GPU overclock       Requires a vendor SDK (NVAPI / ADL). NOT detected.
//   Graphics settings   No general way to read an arbitrary game's config.
//                       NOT detected.
//
// Driver version note: Win32_VideoController.DriverVersion is the Windows
// driver build (e.g. 32.0.15.6636), not the vendor's marketing version (e.g.
// 566.36). Both identify the driver; the raw Windows value is recorded because
// it is the one that can be read reliably.

import { execFileSync } from 'node:child_process';

export interface DetectedHardware {
  gpuRaw: string;
  gpuDriverVersion: string;
  cpuRaw: string;
  osBuild: string;
  ramTotalGb: number;
  ramConfiguredSpeedMts?: number;
  dimmCount: number;
}

export class UnsupportedPlatformError extends Error {}

/** Runs a PowerShell expression and returns trimmed stdout. */
function powershell(script: string): string {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf-8', timeout: 30_000 },
  ).trim();
}

/**
 * Reads what Windows can tell us about this machine.
 *
 * Throws on any other platform rather than returning partial or fabricated
 * values — a collector that "works" on Linux would produce observations whose
 * hardware fields mean nothing.
 */
export function detectWindowsEnvironment(runPowershell: (s: string) => string = powershell): DetectedHardware {
  if (process.platform !== 'win32') {
    throw new UnsupportedPlatformError(
      `This collector measures real hardware and must run on Windows (detected platform: ${process.platform}). ` +
        'There is no fallback path — a run assembled off-target would carry hardware fields that describe nothing.',
    );
  }

  const raw = runPowershell(
    '$g = Get-CimInstance Win32_VideoController | Select-Object -First 1; ' +
      '$c = Get-CimInstance Win32_Processor | Select-Object -First 1; ' +
      '$o = Get-CimInstance Win32_OperatingSystem; ' +
      '$m = @(Get-CimInstance Win32_PhysicalMemory); ' +
      '[pscustomobject]@{ ' +
      'gpu = $g.Name; driver = $g.DriverVersion; cpu = $c.Name; ' +
      'os = "$($o.Caption) $($o.Version) build $($o.BuildNumber)"; ' +
      'ramBytes = ($m | Measure-Object -Property Capacity -Sum).Sum; ' +
      'ramSpeed = ($m | Select-Object -First 1).ConfiguredClockSpeed; ' +
      'dimms = $m.Count } | ConvertTo-Json -Compress',
  );

  const parsed = JSON.parse(raw) as {
    gpu?: string; driver?: string; cpu?: string; os?: string;
    ramBytes?: number; ramSpeed?: number; dimms?: number;
  };

  const missing = (['gpu', 'driver', 'cpu', 'os'] as const).filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(`Windows reported no value for: ${missing.join(', ')}. Not substituting defaults.`);
  }

  return {
    gpuRaw: String(parsed.gpu).trim(),
    gpuDriverVersion: String(parsed.driver).trim(),
    cpuRaw: String(parsed.cpu).trim(),
    osBuild: String(parsed.os).trim(),
    ramTotalGb: Math.round(((parsed.ramBytes ?? 0) / 1024 ** 3) * 100) / 100,
    ramConfiguredSpeedMts: parsed.ramSpeed && parsed.ramSpeed > 0 ? parsed.ramSpeed : undefined,
    dimmCount: parsed.dimms ?? 0,
  };
}

/** Reads a game executable's file version. Returns undefined rather than guessing. */
export function detectExecutableVersion(
  exePath: string,
  runPowershell: (s: string) => string = powershell,
): string | undefined {
  try {
    const v = runPowershell(`(Get-Item -LiteralPath ${JSON.stringify(exePath)}).VersionInfo.FileVersion`);
    return v && v !== '' ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Fields this platform cannot detect today, with why. Kept beside the probe so the two stay in step. */
export const KNOWN_DETECTION_GAPS = [
  { field: 'ram.channels', reason: 'Windows exposes DIMM slots, not physical channel mapping; deriving channels requires motherboard-specific knowledge.' },
  { field: 'detected.gpuOverclockDetected', reason: 'Requires a vendor SDK (NVAPI/ADL) that this collector does not link.' },
  { field: 'settingsHash', reason: 'No general mechanism exists to read an arbitrary game\'s graphics configuration.' },
] as const;
