export interface CompatibilityWarning {
  id: string;
  type: 'error' | 'warning';
  /** Short label of the problem, e.g. "CPU won't fit this motherboard" */
  title: string;
  /** What exactly is wrong and why it matters */
  detail: string;
  /** How to resolve it */
  fix?: string;
  /** How certain the check is — 'certain' for spec-level facts, 'likely' where real products vary */
  confidence: 'certain' | 'likely';
}

export interface CompatibilityResult {
  warnings: CompatibilityWarning[];
  /** Names of the checks that ran and passed, for the all-clear banner */
  passed: string[];
}

export function checkCompatibility(parts: {
  gpu?: { tdp_watts: number; name: string; length_mm?: number } | null;
  cpu?: { tdp_watts: number; socket: string; supported_ram: string[]; name: string } | null;
  motherboard?: { socket: string; supported_ram: string[]; name: string; form_factor?: string } | null;
  ram?: { type: string; name: string } | null;
  psu?: { wattage: number; name: string } | null;
  case?: { name: string; gpu_clearance_mm?: number; cooler_clearance_mm?: number; motherboard_support?: string[] } | null;
  cooler?: { name: string; type: string; height_mm?: number; max_tdp_watts?: number; socket_support?: string[] } | null;
}): CompatibilityResult {
  const warnings: CompatibilityWarning[] = [];
  const passed: string[] = [];

  // CPU socket vs motherboard socket
  if (parts.cpu && parts.motherboard && typeof parts.cpu.socket === 'string' && typeof parts.motherboard.socket === 'string') {
    if (parts.cpu.socket !== parts.motherboard.socket) {
      warnings.push({
        id: 'socket-mismatch',
        type: 'error',
        title: 'CPU physically won\'t fit this motherboard',
        detail: `${parts.cpu.name} uses the ${parts.cpu.socket} socket, but ${parts.motherboard.name} has an ${parts.motherboard.socket} socket. These are different shapes — the CPU cannot be installed at all.`,
        fix: `Pick a ${parts.cpu.socket} motherboard, or a ${parts.motherboard.socket} CPU.`,
        confidence: 'certain',
      });
    } else {
      passed.push('CPU socket');
    }
  }

  // Cooler socket vs CPU socket — most coolers use universal mounting
  // brackets and have no socket_support field at all (treated as
  // compatible with everything); a handful of compact low-profile
  // coolers are genuinely single-socket designs.
  if (Array.isArray(parts.cooler?.socket_support) && parts.cpu && typeof parts.cpu.socket === 'string') {
    if (!parts.cooler.socket_support.includes(parts.cpu.socket)) {
      warnings.push({
        id: 'cooler-socket-mismatch',
        type: 'error',
        title: 'Cooler doesn\'t mount on this CPU\'s socket',
        detail: `${parts.cooler.name} only mounts on ${parts.cooler.socket_support.join('/')}, but ${parts.cpu.name} uses ${parts.cpu.socket}. This cooler's bracket physically won't attach.`,
        fix: `Pick a cooler that supports ${parts.cpu.socket}, or a universal-mount cooler.`,
        confidence: 'certain',
      });
    } else {
      passed.push('Cooler socket');
    }
  }

  // RAM type vs motherboard support
  if (parts.ram && parts.motherboard && typeof parts.ram.type === 'string' && Array.isArray(parts.motherboard.supported_ram)) {
    if (!parts.motherboard.supported_ram.includes(parts.ram.type)) {
      warnings.push({
        id: 'ram-type-mismatch',
        type: 'error',
        title: 'RAM won\'t fit this motherboard',
        detail: `${parts.ram.name} is ${parts.ram.type}, but ${parts.motherboard.name} only takes ${parts.motherboard.supported_ram.join('/')}. ${parts.ram.type} and ${parts.motherboard.supported_ram[0]} sticks are keyed differently and are not interchangeable.`,
        fix: `Choose ${parts.motherboard.supported_ram.join(' or ')} memory, or a motherboard that supports ${parts.ram.type}.`,
        confidence: 'certain',
      });
    } else {
      passed.push('RAM type');
    }
  }

  // RAM type vs CPU support
  if (parts.ram && parts.cpu && typeof parts.ram.type === 'string' && Array.isArray(parts.cpu.supported_ram)) {
    if (!parts.cpu.supported_ram.includes(parts.ram.type)) {
      warnings.push({
        id: 'ram-cpu-mismatch',
        type: 'error',
        title: 'CPU doesn\'t support this RAM generation',
        detail: `${parts.cpu.name}'s memory controller supports ${parts.cpu.supported_ram.join('/')}, not ${parts.ram.type}.`,
        fix: `Choose ${parts.cpu.supported_ram.join(' or ')} memory instead.`,
        confidence: 'certain',
      });
    } else if (!parts.motherboard) {
      passed.push('CPU memory support');
    }
  }

  // PSU wattage check
  if (parts.psu && typeof parts.psu.wattage === 'number' &&
      (typeof parts.gpu?.tdp_watts === 'number' || typeof parts.cpu?.tdp_watts === 'number')) {
    const gpuTdp = typeof parts.gpu?.tdp_watts === 'number' ? parts.gpu.tdp_watts : 0;
    const cpuTdp = typeof parts.cpu?.tdp_watts === 'number' ? parts.cpu.tdp_watts : 0;
    const required = gpuTdp + cpuTdp + 100;
    if (parts.psu.wattage < required) {
      warnings.push({
        id: 'psu-insufficient',
        type: 'error',
        title: 'Power supply is too weak for this build',
        detail: `GPU (${gpuTdp}W) + CPU (${cpuTdp}W) + ~100W for everything else needs about ${required}W, but ${parts.psu.name} delivers ${parts.psu.wattage}W. Under gaming load this risks shutdowns, crashes, or the system refusing to boot.`,
        fix: `Choose a PSU of at least ${Math.ceil((required * 1.15) / 50) * 50}W for comfortable headroom.`,
        confidence: 'certain',
      });
    } else if (parts.psu.wattage < required * 1.1) {
      warnings.push({
        id: 'psu-tight',
        type: 'warning',
        title: 'Power headroom is tight',
        detail: `This build needs about ${required}W and ${parts.psu.name} delivers ${parts.psu.wattage}W. It will run, but power spikes (common on modern GPUs) leave little margin, and PSUs run loudest and least efficiently near their limit.`,
        fix: `A ${Math.ceil((required * 1.3) / 50) * 50}W unit would give quieter, cooler operation and room to upgrade.`,
        confidence: 'likely',
      });
    } else {
      passed.push('PSU wattage');
    }
  }

  // Motherboard form factor vs case support
  if (typeof parts.motherboard?.form_factor === 'string' && Array.isArray(parts.case?.motherboard_support)) {
    if (!parts.case.motherboard_support.includes(parts.motherboard.form_factor)) {
      warnings.push({
        id: 'mobo-case-mismatch',
        type: 'error',
        title: 'Motherboard won\'t mount in this case',
        detail: `${parts.motherboard.name} is ${parts.motherboard.form_factor}, but ${parts.case.name} only fits ${parts.case.motherboard_support.join('/')} boards.`,
        fix: `Pick a case that supports ${parts.motherboard.form_factor}, or a ${parts.case.motherboard_support.join('/')} motherboard.`,
        confidence: 'certain',
      });
    } else {
      passed.push('Motherboard fit');
    }
  }

  // GPU length vs case clearance — lengths vary by card model, so this is a
  // 'likely' check based on typical models of each GPU.
  if (typeof parts.gpu?.length_mm === 'number' && typeof parts.case?.gpu_clearance_mm === 'number') {
    const len = parts.gpu.length_mm;
    const max = parts.case.gpu_clearance_mm;
    if (len > max) {
      warnings.push({
        id: 'gpu-too-long',
        type: 'error',
        title: 'GPU is likely too long for this case',
        detail: `Typical ${parts.gpu.name} cards are ~${len}mm long, but ${parts.case.name} has ${max}mm of GPU clearance. Most models of this card will not physically fit.`,
        fix: `Pick a roomier case, or look specifically for a compact model of this GPU and verify its exact length before buying.`,
        confidence: 'likely',
      });
    } else if (len > max - 15) {
      warnings.push({
        id: 'gpu-tight-fit',
        type: 'warning',
        title: 'GPU fit will be tight',
        detail: `Typical ${parts.gpu.name} cards run ~${len}mm and ${parts.case.name} allows ${max}mm — only ~${max - len}mm to spare. Longer models of this card (lengths vary by manufacturer) may not fit.`,
        fix: `Check the exact length of the specific card model you plan to buy against ${max}mm.`,
        confidence: 'likely',
      });
    } else {
      passed.push('GPU clearance');
    }
  }

  // Air cooler height vs case clearance (AIO pumps are low-profile, so the
  // height check only applies to tower air coolers)
  if (typeof parts.cooler?.height_mm === 'number' && typeof parts.case?.cooler_clearance_mm === 'number') {
    const h = parts.cooler.height_mm;
    const max = parts.case.cooler_clearance_mm;
    if (h > max) {
      warnings.push({
        id: 'cooler-too-tall',
        type: 'error',
        title: 'CPU cooler is too tall — the side panel won\'t close',
        detail: `${parts.cooler.name} is ${h}mm tall, but ${parts.case.name} allows ${max}mm of cooler clearance.`,
        fix: `Choose a shorter air cooler (under ${max}mm) or a liquid AIO cooler, which has no height constraint.`,
        confidence: 'certain',
      });
    } else if (h > max - 5) {
      warnings.push({
        id: 'cooler-tight-fit',
        type: 'warning',
        title: 'CPU cooler clearance is very tight',
        detail: `${parts.cooler.name} (${h}mm) fits ${parts.case.name}'s ${max}mm clearance with only ${max - h}mm to spare — tall RAM under the cooler or slight spec variance could interfere.`,
        fix: `It should fit, but double-check if you're using RAM with tall heat spreaders.`,
        confidence: 'likely',
      });
    } else {
      passed.push('Cooler height');
    }
  }

  // Cooler capacity vs CPU heat
  if (typeof parts.cooler?.max_tdp_watts === 'number' && parts.cpu && typeof parts.cpu.tdp_watts === 'number') {
    if (parts.cpu.tdp_watts > parts.cooler.max_tdp_watts) {
      warnings.push({
        id: 'cooler-undersized',
        type: 'warning',
        title: 'Cooler may struggle with this CPU',
        detail: `${parts.cpu.name} can draw up to ${parts.cpu.tdp_watts}W, above the ~${parts.cooler.max_tdp_watts}W ${parts.cooler.name} is rated for. The CPU will still work, but it will run hot and lose performance under sustained load (thermal throttling).`,
        fix: `Pick a cooler rated for at least ${parts.cpu.tdp_watts}W for full performance.`,
        confidence: 'likely',
      });
    } else {
      passed.push('Cooler capacity');
    }
  }

  return { warnings, passed };
}
