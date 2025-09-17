import { ExtractedDiscountData } from '../discountDataExtractor.server';
import { DiscountMetafieldRule } from '@prisma/client';
import { 
  ProductDiscount, 
  ProductDiscountInput, 
  ProductDiscountWithDetails,
  BulkOperationResult,
  SyncResult,
  RelationshipStatistics,
  ProductWithDiscounts,
  DiscountWithProducts,
  ProductDiscountSummary,
  ProductDiscountResult,
  DiscountProductResult
} from '../../types/product-discount.types';

/**
 * Core discount service interface
 * Defines the contract for discount-related operations
 */
export interface IDiscountService {
  /**
   * Process discount creation from webhook
   */
  processDiscountCreate(payload: any): Promise<ExtractedDiscountData>;
  
  /**
   * Process discount update from webhook
   */
  processDiscountUpdate(payload: any): Promise<ExtractedDiscountData>;
  
  /**
   * Process discount deletion from webhook
   */
  processDiscountDelete(payload: any): Promise<{ id: string; deleted: boolean }>;
  
  /**
   * Initialize all existing discounts from Shopify
   */
  initializeAllDiscounts(): Promise<InitializationResult>;
  
  /**
   * Get all discounts from Shopify
   */
  getAllDiscountsFromShopify(): Promise<ExtractedDiscountData[]>;
  
  /**
   * Get a specific discount from Shopify by ID
   */
  getDiscountFromShopify(discountId: string): Promise<ExtractedDiscountData | null>;
  
  // NEW: Relationship-aware methods
  
  /**
   * Remove discount from product metafields (only products with ProductDiscount relationships)
   */
  removeFromProductMetafields(existingRule: any, discountId: string): Promise<void>;
}

/**
 * Product metafield service interface
 */
export interface IProductMetafieldService {
  /**
   * Update product metafield with discount data
   */
  updateProductMetafield(productId: string, discountData: ExtractedDiscountData): Promise<boolean>;
  
  /**
   * Remove discount from product metafield
   */
  removeDiscountFromProduct(productId: string, discountId: string): Promise<boolean>;
  
  /**
   * Get product metafield value
   */
  getProductMetafield(productId: string): Promise<string | null>;
  
  /**
   * Update multiple product metafields
   */
  updateMultipleProductMetafields(productIds: string[], discountData: ExtractedDiscountData): Promise<BulkUpdateResult>;
  
  /**
   * Remove discount from multiple products
   */
  removeDiscountFromMultipleProducts(productIds: string[], discountId: string): Promise<BulkUpdateResult>;
  

}

/**
 * Discount targeting service interface
 */
export interface IDiscountTargetingService {
  /**
   * Get products affected by a discount
   */
  getAffectedProducts(discountId: string): Promise<string[]>;
  
  /**
   * Get discount targeting information
   */
  getDiscountTargeting(discountId: string): Promise<DiscountTargeting>;
  
  /**
   * Get all product IDs from the store
   */
  getAllProductIds(): Promise<string[]>;
  
  /**
   * Get products from collections
   */
  getProductsFromCollections(collectionIds: string[]): Promise<string[]>;
}

/**
 * Result interfaces
 */
export interface BulkUpdateResult {
  successCount: number;
  failureCount: number;
  errors: Array<{ productId: string; error: string }>;
  totalProcessed: number;
}

export interface InitializationResult {
  success: boolean;
  totalFound: number;
  processed: number;
  skipped: number;
  errors: number;
  error?: string;
}

export interface DiscountTargeting {
  appliesToAllProducts: boolean;
  productIds: string[];
  collectionIds: string[];
  notFound?: boolean; // Indicates if the discount couldn't be found with any node type
}

export interface ProductMetafieldUpdate {
  productId: string;
  metafieldData: any;
  success: boolean;
  error?: string;
}

/**
 * Product service interface
 */
export interface IProductService {
  /**
   * Fetch all products from Shopify and save to database
   */
  fetchAndSaveAllProducts(): Promise<ProductFetchResult>;
  
  /**
   * Get all products from database
   */
  getAllProducts(): Promise<Product[]>;
  
  /**
   * Get a specific product by Shopify ID from database
   */
  getProductById(shopifyId: string): Promise<Product | null>;
  
  /**
   * Get a specific product by internal database ID
   */
  getProductByInternalId(internalId: number): Promise<Product | null>;
  
  /**
   * Update product's active discounts
   */
  updateProductActiveDiscounts(shopifyId: string, activeDiscounts: string): Promise<boolean>;
  
  /**
   * Get products count from database
   */
  getProductsCount(): Promise<number>;
  
  /**
   * Sync a single product from Shopify to database
   */
  syncProductFromShopify(shopifyId: string): Promise<boolean>;

  // Webhook processing methods
  processProductCreate(payload: any): Promise<Product>;
  processProductUpdate(payload: any): Promise<Product>;
  processProductDelete(payload: any): Promise<{ deleted: boolean; shopifyId: string }>;
  
  // NEW: Relationship-aware methods
  getProductWithDiscounts(shopifyId: string): Promise<ProductWithDiscounts | null>;
  updateProductDiscounts(shopifyId: string, discountIds: number[]): Promise<boolean>;
  getProductDiscountCount(shopifyId: string): Promise<number>;
}

/**
 * Product data structure
 */
export interface Product {
  id: number;
  shop: string;
  shopifyId: string;
  title: string;
  handle: string;
  description?: string;
  productType?: string;
  vendor?: string;
  status: string;
  variantsCount: number;
  imagesCount: number;
  tags?: string;
  activeDiscounts?: string; // Keep for backward compatibility
  createdAt: Date;
  updatedAt: Date;
  lastFetchedAt: Date;
  
  // Relationship data (optional for backward compatibility)
  productDiscounts?: ProductDiscount[];
}

/**
 * Product fetch result
 */
export interface ProductFetchResult {
  success: boolean;
  totalFound: number;
  processed: number;
  skipped: number;
  errors: number;
  error?: string;
  products?: Product[];
}

/**
 * ProductDiscount service interface
 */
export interface IProductDiscountService {
  // Core relationship management
  createRelationship(productId: number, discountId: number): Promise<ProductDiscount>;
  removeRelationship(productId: number, discountId: number): Promise<boolean>;
  toggleRelationship(productId: number, discountId: number): Promise<ProductDiscount | null>;
  
  // Bulk operations
  createBulkRelationships(relationships: ProductDiscountInput[]): Promise<BulkOperationResult>;
  removeBulkRelationships(relationships: ProductDiscountInput[]): Promise<BulkOperationResult>;
  syncProductDiscounts(productId: number, discountIds: number[]): Promise<SyncResult>;
  syncDiscountProducts(discountId: number, productIds: number[]): Promise<SyncResult>;
  
  // Query operations
  getProductDiscounts(productId: number): Promise<ProductDiscountWithDetails[]>;
  getDiscountProducts(discountId: number): Promise<ProductDiscountWithDetails[]>;
  getActiveRelationships(shop?: string): Promise<ProductDiscountWithDetails[]>;
  
  // Status management
  activateProductDiscounts(productId: number): Promise<number>;
  deactivateProductDiscounts(productId: number): Promise<number>;
  activateDiscountProducts(discountId: number): Promise<number>;
  deactivateDiscountProducts(discountId: number): Promise<number>;
  
  // Integration with existing services
  syncWithProductMetafields(productId: number): Promise<boolean>;
  syncWithDiscountMetafields(discountId: number): Promise<boolean>;
  
  // Statistics and reporting
  getRelationshipStatistics(shop?: string): Promise<RelationshipStatistics>;
  getProductDiscountCounts(productIds: number[]): Promise<Map<number, number>>;
  getDiscountProductCounts(discountIds: number[]): Promise<Map<number, number>>;
}

// Types are now imported from centralized types file