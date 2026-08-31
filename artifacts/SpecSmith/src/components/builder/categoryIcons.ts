import {
  Box,
  Cpu,
  Fan,
  Gamepad2,
  HardDrive,
  Headphones,
  Keyboard,
  MemoryStick,
  Monitor,
  Mouse,
  Plug,
  Server,
  type LucideIcon,
} from 'lucide-react';

import type { RetailPartCategory } from '../../lib/retail/partCatalog';

/** One icon per category, so the rail and the chips agree. */
export const CATEGORY_ICONS: Readonly<Record<RetailPartCategory, LucideIcon>> = {
  gpu: Gamepad2,
  cpu: Cpu,
  motherboard: Server,
  ram: MemoryStick,
  storage: HardDrive,
  psu: Plug,
  case: Box,
  cooler: Fan,
  monitor: Monitor,
  keyboard: Keyboard,
  mouse: Mouse,
  headset: Headphones,
};
