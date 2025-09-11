import { ExtractedDiscountData } from '../discountDataExtractor.server';

export interface IDiscountService {
  getAllDiscounts(): Promise<ExtractedDiscountData[]>;
  getDiscountById(id: string): Promise<ExtractedDiscountData | null>;
  getAffectedProducts(discountId: string): Promise<string[]>;
  updateProductMetafields(productIds: string[], discountData: ExtractedDiscountData): Promise<BulkUpdateResult>;
  removeDiscountFromProducts(productIds: string[], discountId: string): Promise<BulkUpdateResult>;
}

export interface BulkUpdateResult {
  successCount: number;
  failureCount: number;
  errors: Array<{ productId: string; error: string }>;
  totalProcessed: number;
}

export interface DiscountTargeting {
  appliesToAllProducts: boolean;
  productIds: string[];
  collectionIds: string[];
}

export interface ProductMetafieldUpdate {
  productId: string;
  metafieldData: any;
  success: boolean;
  error?: string;
}

