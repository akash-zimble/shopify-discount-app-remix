import { DiscountMetafieldRule, Product } from "@prisma/client";
import { ProductDiscount } from "../../types/product-discount.types";

/**
 * Base repository interface for common database operations
 */
export interface IRepository<T, K> {
  findById(id: K): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: K, data: Partial<T>): Promise<T>;
  delete(id: K): Promise<boolean>;
}

/**
 * Discount repository interface
 */
export interface IDiscountRepository extends IRepository<DiscountMetafieldRule, number> {
  findByDiscountId(discountId: string): Promise<DiscountMetafieldRule | null>;
  findActiveDiscounts(): Promise<DiscountMetafieldRule[]>;
  updateByDiscountId(discountId: string, data: Partial<DiscountMetafieldRule>): Promise<number>;
  deactivateByDiscountId(discountId: string): Promise<number>;
  updateProductsCount(discountId: string, count: number): Promise<void>;
}

/**
 * ProductDiscount repository interface
 */
export interface IProductDiscountRepository extends IRepository<ProductDiscount, number> {
  // Basic relationship operations
  findByProductId(productId: number): Promise<ProductDiscount[]>;
  findByDiscountId(discountId: number): Promise<ProductDiscount[]>;
  findByProductAndDiscount(productId: number, discountId: number): Promise<ProductDiscount | null>;
  
  // Bulk operations
  createBulk(relationships: Partial<ProductDiscount>[]): Promise<ProductDiscount[]>;
  deleteByProductId(productId: number): Promise<number>;
  deleteByDiscountId(discountId: number): Promise<number>;
  
  // Status management
  activateByProductId(productId: number): Promise<number>;
  deactivateByProductId(productId: number): Promise<number>;
  activateByDiscountId(discountId: number): Promise<number>;
  deactivateByDiscountId(discountId: number): Promise<number>;
  
  // Query operations
  findActiveByShop(shop: string): Promise<ProductDiscount[]>;
  countByDiscountId(discountId: number): Promise<number>;
  countByProductId(productId: number): Promise<number>;
  
  // Advanced queries with relationships
  findProductsWithDiscount(discountId: number): Promise<Product[]>;
  findDiscountsForProduct(productId: number): Promise<DiscountMetafieldRule[]>;
  
  // Statistics
  getStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
  }>;
}

