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

/** One entry from Win32_VideoController. */
export interface VideoAdapter {
  name: string;
  driverVersion: string;
  pnpDeviceId: string;
}

export class AmbiguousAdapterError extends Error {}

/**
 * Adapters that are never the GPU that rendered a game.
 *
 * Deliberately a short, explicit list of software/virtual display devices
 * rather than a cleverer heuristic. The obvious alternatives are all wrong:
 * AdapterRAM is a 32-bit field that misreports anything above 4 GB, and
 * filtering by PCI vendor id cannot separate an Intel iGPU from an Intel Arc
 * discrete card, or an AMD APU from an AMD discrete card.
 *
 * "Microsoft Basic Display Adapter" appearing alone means the real driver is
 * not loaded — that is a broken machine to benchmark on, and excluding it here
 * makes the collector say so rather than measure it.
 */
const NON_RENDERING_ADAPTER_PATTERNS = [
  /Microsoft Basic Display/i,
  /Microsoft Remote Display/i,
  /Remote Desktop/i,
  /DisplayLink/i,
  /Indirect Display/i,
  /Virtual Display/i,
  /VirtualBox/i,
  /VMware/i,
  /Parsec/i,
  /Meta Virtual Monitor/i,
];

export function isRenderingAdapter(name: string): boolean {
  return !NON_RENDERING_ADAPTER_PATTERNS.some((re) => re.test(name));
}

/**
 * Picks the adapter that rendered the run.
 *
 * `Select-Object -First 1` — what this replaces — silently returned whichever
 * adapter Windows happened to enumerate first. On any machine with integrated
 * graphics (most Intel CPUs, every AMD APU, every laptop) that can be the iGPU
 * rather than the discrete card, and because the driver version is read from
 * the same object BOTH fields would be wrong together, with no error.
 *
 * There is no reliable way to identify the rendering adapter from WMI alone —
 * PresentMon's CSV does not name it either. So ambiguity is REPORTED, not
 * guessed at: with more than one candidate the operator must name the adapter.
 */
export function selectAdapter(adapters: readonly VideoAdapter[], preferredName?: string): VideoAdapter {
  const describe = (list: readonly VideoAdapter[]) => list.map((a) => `"${a.name}"`).join(', ');

  if (adapters.length === 0) throw new Error('Windows reported no video adapters at all.');

  if (preferredName) {
    const wanted = preferredName.trim().toLowerCase();
    const exact = adapters.filter((a) => a.name.trim().toLowerCase() === wanted);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      throw new AmbiguousAdapterError(`More than one adapter is named "${preferredName}". Cannot disambiguate by name.`);
    }
    const partial = adapters.filter((a) => a.name.toLowerCase().includes(wanted));
    if (partial.length === 1) return partial[0];
    throw new AmbiguousAdapterError(
      `No adapter matches --gpu-name "${preferredName}". Adapters present: ${describe(adapters)}.`,
    );
  }

  const rendering = adapters.filter((a) => isRenderingAdapter(a.name));

  if (rendering.length === 1) return rendering[0];

  if (rendering.length === 0) {
    throw new AmbiguousAdapterError(
      `No rendering GPU found — every adapter looks like a virtual or fallback display device: ${describe(adapters)}. ` +
        'If the real GPU driver is not installed, this machine should not be benchmarked.',
    );
  }

  throw new AmbiguousAdapterError(
    `This machine has ${rendering.length} rendering adapters (${describe(rendering)}) and the collector will not guess which one ran the game. ` +
      'Pass --gpu-name "<exact adapter name>" to select it. Picking the wrong one would silently record the wrong GPU AND the wrong driver version.',
  );
}

export interface DetectedHardware {
  gpuRaw: string;
  gpuDriverVersion: string;
  cpuRaw: string;
  osBuild: string;
  ramTotalGb: number;
  ramConfiguredSpeedMts?: number;
  dimmCount: number;
  /** Every adapter Windows reported, so a wrong selection stays auditable. */
  adaptersSeen: string[];
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
export function detectWindowsEnvironment(
  runPowershell: (s: string) => string = powershell,
  preferredGpuName?: string,
): DetectedHardware {
  if (process.platform !== 'win32') {
    throw new UnsupportedPlatformError(
      `This collector measures real hardware and must run on Windows (detected platform: ${process.platform}). ` +
        'There is no fallback path — a run assembled off-target would carry hardware fields that describe nothing.',
    );
  }

  const raw = runPowershell(
    '$adapters = @(Get-CimInstance Win32_VideoController | ' +
      'Select-Object -Property Name, DriverVersion, PNPDeviceID); ' +
      '$c = Get-CimInstance Win32_Processor | Select-Object -First 1; ' +
      '$o = Get-CimInstance Win32_OperatingSystem; ' +
      '$m = @(Get-CimInstance Win32_PhysicalMemory); ' +
      '[pscustomobject]@{ ' +
      'adapters = $adapters; cpu = $c.Name; ' +
      'os = "$($o.Caption) $($o.Version) build $($o.BuildNumber)"; ' +
      'ramBytes = ($m | Measure-Object -Property Capacity -Sum).Sum; ' +
      'ramSpeed = ($m | Select-Object -First 1).ConfiguredClockSpeed; ' +
      'dimms = $m.Count } | ConvertTo-Json -Compress -Depth 4',
  );

  const parsed = JSON.parse(raw) as {
    adapters?: Array<{ Name?: string; DriverVersion?: string; PNPDeviceID?: string }> | { Name?: string; DriverVersion?: string; PNPDeviceID?: string };
    cpu?: string; os?: string; ramBytes?: number; ramSpeed?: number; dimms?: number;
  };

  // ConvertTo-Json emits a bare object rather than an array when there is
  // exactly one adapter.
  const adapterList = parsed.adapters === undefined ? [] : Array.isArray(parsed.adapters) ? parsed.adapters : [parsed.adapters];
  const adapters: VideoAdapter[] = adapterList.map((a) => ({
    name: String(a.Name ?? '').trim(),
    driverVersion: String(a.DriverVersion ?? '').trim(),
    pnpDeviceId: String(a.PNPDeviceID ?? '').trim(),
  }));

  const gpu = selectAdapter(adapters, preferredGpuName);

  const missing: string[] = [];
  if (!gpu.name) missing.push('GPU name');
  if (!gpu.driverVersion) missing.push('GPU driver version');
  if (!parsed.cpu) missing.push('CPU');
  if (!parsed.os) missing.push('OS build');
  if (missing.length > 0) {
    throw new Error(`Windows reported no value for: ${missing.join(', ')}. Not substituting defaults.`);
  }

  return {
    gpuRaw: gpu.name,
    gpuDriverVersion: gpu.driverVersion,
    cpuRaw: String(parsed.cpu).trim(),
    osBuild: String(parsed.os).trim(),
    ramTotalGb: Math.round(((parsed.ramBytes ?? 0) / 1024 ** 3) * 100) / 100,
    ramConfiguredSpeedMts: parsed.ramSpeed && parsed.ramSpeed > 0 ? parsed.ramSpeed : undefined,
    dimmCount: parsed.dimms ?? 0,
    adaptersSeen: adapters.map((a) => a.name),
  };
}

/**
 * Reads a game executable's file version.
 *
 * The path is handed to PowerShell through an ENVIRONMENT VARIABLE, never
 * interpolated into the command string. The previous version used
 * JSON.stringify to quote it, which is JS escaping, not PowerShell escaping:
 * PowerShell does not treat backslash as an escape character, so a Windows
 * path arrived with every separator doubled. Env-var passing removes the
 * quoting problem entirely rather than trying to escape correctly.
 *
 * Returns undefined rather than guessing when the version cannot be read.
 */
export function detectExecutableVersion(
  exePath: string,
  runPowershellWithEnv: (script: string, env: NodeJS.ProcessEnv) => string = (script, env) =>
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, ...env },
    }).trim(),
): string | undefined {
  try {
    const v = runPowershellWithEnv(
      '(Get-Item -LiteralPath $env:SPECSMITH_GAME_EXE).VersionInfo.FileVersion',
      { SPECSMITH_GAME_EXE: exePath },
    );
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
