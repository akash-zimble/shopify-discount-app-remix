import { DiscountMetafieldRule } from "@prisma/client";

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

