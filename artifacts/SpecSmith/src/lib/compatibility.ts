export interface CompatibilityWarning {
  id: string;
  type: 'error' | 'warning';
  message: string;
}

export function checkCompatibility(parts: {
  gpu?: { tdp_watts: number; name: string } | null;
  cpu?: { tdp_watts: number; socket: string; supported_ram: string[]; name: string } | null;
  motherboard?: { socket: string; supported_ram: string[]; name: string } | null;
  ram?: { type: string; name: string } | null;
  psu?: { wattage: number; name: string } | null;
}): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];

  // CPU socket vs motherboard socket
  if (parts.cpu && parts.motherboard) {
    if (parts.cpu.socket !== parts.motherboard.socket) {
      warnings.push({
        id: 'socket-mismatch',
        type: 'error',
        message: `Socket mismatch: ${parts.cpu.name} uses ${parts.cpu.socket} but ${parts.motherboard.name} requires ${parts.motherboard.socket}.`
      });
    }
  }

  // RAM type vs motherboard support
  if (parts.ram && parts.motherboard) {
    if (!parts.motherboard.supported_ram.includes(parts.ram.type)) {
      warnings.push({
        id: 'ram-type-mismatch',
        type: 'error',
        message: `RAM mismatch: ${parts.ram.name} (${parts.ram.type}) is not supported by ${parts.motherboard.name} (supports ${parts.motherboard.supported_ram.join(', ')}).`
      });
    }
  }

  // RAM type vs CPU support
  if (parts.ram && parts.cpu) {
    if (!parts.cpu.supported_ram.includes(parts.ram.type)) {
      warnings.push({
        id: 'ram-cpu-mismatch',
        type: 'error',
        message: `RAM mismatch: ${parts.ram.name} (${parts.ram.type}) is not supported by ${parts.cpu.name} (supports ${parts.cpu.supported_ram.join(', ')}).`
      });
    }
  }

  // PSU wattage check
  if (parts.psu && (parts.gpu || parts.cpu)) {
    const gpuTdp = parts.gpu?.tdp_watts ?? 0;
    const cpuTdp = parts.cpu?.tdp_watts ?? 0;
    const required = gpuTdp + cpuTdp + 100;
    if (parts.psu.wattage < required) {
      warnings.push({
        id: 'psu-insufficient',
        type: 'error',
        message: `Insufficient power: ${parts.psu.name} (${parts.psu.wattage}W) may not be enough. GPU (${gpuTdp}W) + CPU (${cpuTdp}W) + overhead (100W) = ${required}W required.`
      });
    } else if (parts.psu.wattage < required * 1.1) {
      warnings.push({
        id: 'psu-tight',
        type: 'warning',
        message: `Power headroom is tight: ${parts.psu.name} (${parts.psu.wattage}W) leaves little headroom above the ${required}W requirement. Consider a higher wattage PSU.`
      });
    }
  }

  return warnings;
}
