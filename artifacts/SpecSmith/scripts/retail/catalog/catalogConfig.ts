import { AFFILIATE_PART_CATEGORY_TARGETS, type RetailPartCategory } from '../../../src/lib/retail/partCatalog';

export interface RetailCategoryConfig {
  category: RetailPartCategory;
  keyword: string;
  categoryLeaf: string;
  quota: number;
}

// Exact leaves observed from the live Newegg/Rakuten feed on 2026-08-29.
// Quotas sum to 500. They intentionally favor core components while leaving
// enough room for a useful peripheral catalog.
export const RETAIL_CATEGORY_CONFIG: readonly RetailCategoryConfig[] = [
  { category: 'gpu', keyword: 'graphics card', categoryLeaf: 'Video Cards & Adapters', quota: AFFILIATE_PART_CATEGORY_TARGETS.gpu },
  { category: 'cpu', keyword: 'desktop processor', categoryLeaf: 'Computer Processors', quota: AFFILIATE_PART_CATEGORY_TARGETS.cpu },
  { category: 'motherboard', keyword: 'motherboard', categoryLeaf: 'Motherboards', quota: AFFILIATE_PART_CATEGORY_TARGETS.motherboard },
  { category: 'ram', keyword: 'desktop memory', categoryLeaf: 'RAM', quota: AFFILIATE_PART_CATEGORY_TARGETS.ram },
  { category: 'storage', keyword: 'internal SSD', categoryLeaf: 'Storage Devices', quota: AFFILIATE_PART_CATEGORY_TARGETS.storage },
  { category: 'psu', keyword: 'ATX power supply', categoryLeaf: 'Computer Power Supplies', quota: AFFILIATE_PART_CATEGORY_TARGETS.psu },
  { category: 'case', keyword: 'computer case', categoryLeaf: 'Desktop Computer & Server Cases', quota: AFFILIATE_PART_CATEGORY_TARGETS.case },
  { category: 'cooler', keyword: 'CPU cooler', categoryLeaf: 'Computer System Cooling Parts', quota: AFFILIATE_PART_CATEGORY_TARGETS.cooler },
  { category: 'monitor', keyword: 'gaming monitor', categoryLeaf: 'Computer Monitors', quota: AFFILIATE_PART_CATEGORY_TARGETS.monitor },
  { category: 'keyboard', keyword: 'mechanical keyboard', categoryLeaf: 'Keyboards', quota: AFFILIATE_PART_CATEGORY_TARGETS.keyboard },
  { category: 'mouse', keyword: 'gaming mouse', categoryLeaf: 'Mice & Trackballs', quota: AFFILIATE_PART_CATEGORY_TARGETS.mouse },
  { category: 'headset', keyword: 'gaming headset', categoryLeaf: 'Headphones & Headsets', quota: AFFILIATE_PART_CATEGORY_TARGETS.headset },
] as const;
