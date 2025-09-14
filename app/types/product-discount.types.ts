/**
 * Product-Discount Relationship Types
 * Centralized type definitions for product-discount relationships
 */

import { DiscountMetafieldRule } from '@prisma/client';

/**
 * Core relationship types
 */
export interface ProductDiscount {
  id: number;
  productId: number;
  discountId: number;
  shop: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  product?: Product;
  discount?: DiscountMetafieldRule;
}

export interface ProductDiscountInput {
  productId: number;
  discountId: number;
  isActive?: boolean;
}

export interface ProductDiscountWithDetails extends ProductDiscount {
  product: Product;
  discount: DiscountMetafieldRule;
}

/**
 * Enhanced Product type with relationship data
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
 * Composite types for enhanced data access
 */
export interface ProductWithDiscounts extends Product {
  productDiscounts: ProductDiscountWithDetails[];
  discountCount: number;
}

export interface DiscountWithProducts extends DiscountMetafieldRule {
  productDiscounts: ProductDiscountWithDetails[];
  productCount: number;
}

/**
 * Summary types for UI display
 */
export interface ProductDiscountSummary {
  productId: number;
  productTitle: string;
  productShopifyId: string;
  discountId: number;
  discountTitle: string;
  discountShopifyId: string;
  isActive: boolean;
  createdAt: Date;
  shop: string;
}

export interface ProductSummary {
  id: number;
  shopifyId: string;
  title: string;
  handle: string;
  status: string;
  discountCount?: number;
  productDiscounts?: ProductDiscountSummary[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscountSummary {
  id: number;
  discountId: string;
  discountTitle: string;
  discountType: string;
  status: string;
  isActive: boolean;
  productCount?: number;
  productDiscounts?: ProductDiscountSummary[];
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result types for operations
 */
export interface BulkOperationResult {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ input: ProductDiscountInput; error: string }>;
}

export interface SyncResult {
  success: boolean;
  added: number;
  removed: number;
  errors: number;
  errorDetails: string[];
}

export interface RelationshipStatistics {
  total: number;
  active: number;
  inactive: number;
  productsWithDiscounts: number;
  discountsWithProducts: number;
}

export interface ProductDiscountResult {
  success: boolean;
  product?: ProductWithDiscounts;
  error?: string;
}

export interface DiscountProductResult {
  success: boolean;
  discount?: DiscountWithProducts;
  error?: string;
}

/**
 * Query filter types
 */
export interface ProductDiscountFilters {
  shop?: string;
  isActive?: boolean;
  productId?: number;
  discountId?: number;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface ProductFilters {
  shop?: string;
  status?: string;
  productType?: string;
  vendor?: string;
  hasDiscounts?: boolean;
  discountCount?: {
    min?: number;
    max?: number;
  };
}

export interface DiscountFilters {
  shop?: string;
  status?: string;
  discountType?: string;
  isActive?: boolean;
  hasProducts?: boolean;
  productCount?: {
    min?: number;
    max?: number;
  };
  startDate?: {
    after?: Date;
    before?: Date;
  };
  endDate?: {
    after?: Date;
    before?: Date;
  };
}

/**
 * Pagination types
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Type guards for runtime type checking
 */
export function isProductWithDiscounts(product: Product): product is ProductWithDiscounts {
  return 'productDiscounts' in product && 'discountCount' in product;
}

export function isDiscountWithProducts(discount: DiscountMetafieldRule): discount is DiscountWithProducts {
  return 'productDiscounts' in discount && 'productCount' in discount;
}

export function isProductDiscountWithDetails(relationship: ProductDiscount): relationship is ProductDiscountWithDetails {
  return 'product' in relationship && 'discount' in relationship;
}

export function isProductDiscountInput(obj: any): obj is ProductDiscountInput {
  return obj && 
    typeof obj.productId === 'number' && 
    typeof obj.discountId === 'number' &&
    (obj.isActive === undefined || typeof obj.isActive === 'boolean');
}

/**
 * Utility types for common operations
 */
export type ProductDiscountStatus = 'active' | 'inactive' | 'all';
export type ProductDiscountSortField = 'createdAt' | 'updatedAt' | 'productTitle' | 'discountTitle';
export type ProductDiscountSortOrder = 'asc' | 'desc';

export interface ProductDiscountSortOptions {
  field: ProductDiscountSortField;
  order: ProductDiscountSortOrder;
}

/**
 * Event types for relationship changes
 */
export interface ProductDiscountEvent {
  type: 'created' | 'updated' | 'deleted' | 'activated' | 'deactivated';
  productDiscount: ProductDiscount;
  timestamp: Date;
  shop: string;
}

export interface ProductDiscountBulkEvent {
  type: 'bulk_created' | 'bulk_updated' | 'bulk_deleted';
  productDiscounts: ProductDiscount[];
  count: number;
  timestamp: Date;
  shop: string;
}

/**
 * API response types
 */
export interface ProductDiscountApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: Date;
}

export interface ProductDiscountListResponse extends ProductDiscountApiResponse<PaginatedResult<ProductDiscountWithDetails>> {}

export interface ProductDiscountCreateResponse extends ProductDiscountApiResponse<ProductDiscount> {}

export interface ProductDiscountBulkResponse extends ProductDiscountApiResponse<BulkOperationResult> {}

export interface ProductDiscountStatsResponse extends ProductDiscountApiResponse<RelationshipStatistics> {}
