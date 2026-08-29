import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';

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
  { category: 'gpu', keyword: 'graphics card', categoryLeaf: 'Video Cards & Adapters', quota: 80 },
  { category: 'cpu', keyword: 'desktop processor', categoryLeaf: 'Computer Processors', quota: 55 },
  { category: 'motherboard', keyword: 'motherboard', categoryLeaf: 'Motherboards', quota: 45 },
  { category: 'ram', keyword: 'desktop memory', categoryLeaf: 'RAM', quota: 45 },
  { category: 'storage', keyword: 'internal SSD', categoryLeaf: 'Storage Devices', quota: 55 },
  { category: 'psu', keyword: 'power supply', categoryLeaf: 'Computer Power Supplies', quota: 35 },
  { category: 'case', keyword: 'computer case', categoryLeaf: 'Desktop Computer & Server Cases', quota: 35 },
  { category: 'cooler', keyword: 'CPU cooler', categoryLeaf: 'Computer System Cooling Parts', quota: 35 },
  { category: 'monitor', keyword: 'gaming monitor', categoryLeaf: 'Computer Monitors', quota: 40 },
  { category: 'keyboard', keyword: 'mechanical keyboard', categoryLeaf: 'Keyboards', quota: 25 },
  { category: 'mouse', keyword: 'gaming mouse', categoryLeaf: 'Mice & Trackballs', quota: 25 },
  { category: 'headset', keyword: 'gaming headset', categoryLeaf: 'Headphones & Headsets', quota: 25 },
] as const;
