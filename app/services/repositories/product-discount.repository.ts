import prisma from '../../db.server';
import { IProductDiscountRepository } from '../interfaces/IRepository';
import { ProductDiscount, ProductDiscountWithDetails } from '../../types/product-discount.types';
import { Product, DiscountMetafieldRule } from '@prisma/client';
import { Logger } from '../../utils/logger.server';

/**
 * ProductDiscount repository implementation
 * Handles all database operations for product-discount relationships
 */
export class ProductDiscountRepository implements IProductDiscountRepository {
  constructor(private logger: Logger, private shop?: string) {}

  // Basic CRUD operations
  async findById(id: number): Promise<ProductDiscount | null> {
    try {
      return await prisma.productDiscount.findUnique({
        where: { id },
        include: {
          product: true,
          discount: true,
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findById', id });
      throw error;
    }
  }

  async findAll(): Promise<ProductDiscount[]> {
    try {
      return await prisma.productDiscount.findMany({
        where: this.shop ? { shop: this.shop } : {},
        include: {
          product: true,
          discount: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findAll', shop: this.shop });
      throw error;
    }
  }

  async create(data: Partial<ProductDiscount>): Promise<ProductDiscount> {
    try {
      return await prisma.productDiscount.create({
        data: {
          productId: data.productId!,
          discountId: data.discountId!,
          shop: this.shop || data.shop || 'unknown',
          isActive: data.isActive ?? true,
          createdAt: data.createdAt || new Date(),
          updatedAt: data.updatedAt || new Date(),
        },
        include: {
          product: true,
          discount: true,
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountRepository.create', 
        data, 
        shop: this.shop 
      });
      throw error;
    }
  }

  async update(id: number, data: Partial<ProductDiscount>): Promise<ProductDiscount> {
    try {
      return await prisma.productDiscount.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: {
          product: true,
          discount: true,
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.update', id, data });
      throw error;
    }
  }

  async delete(id: number): Promise<boolean> {
    try {
      await prisma.productDiscount.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.delete', id });
      return false;
    }
  }

  // Basic relationship operations
  async findByProductId(productId: number): Promise<ProductDiscount[]> {
    try {
      return await prisma.productDiscount.findMany({
        where: { 
          productId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        include: {
          product: true,
          discount: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findByProductId', productId });
      throw error;
    }
  }

  async findByDiscountId(discountId: number): Promise<ProductDiscount[]> {
    try {
      return await prisma.productDiscount.findMany({
        where: { 
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        include: {
          product: true,
          discount: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findByDiscountId', discountId });
      throw error;
    }
  }

  async findByProductAndDiscount(productId: number, discountId: number): Promise<ProductDiscount | null> {
    try {
      return await prisma.productDiscount.findFirst({
        where: { 
          productId,
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        include: {
          product: true,
          discount: true,
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountRepository.findByProductAndDiscount', 
        productId, 
        discountId 
      });
      throw error;
    }
  }

  // Bulk operations
  async createBulk(relationships: Partial<ProductDiscount>[]): Promise<ProductDiscount[]> {
    try {
      const data = relationships.map(rel => ({
        productId: rel.productId!,
        discountId: rel.discountId!,
        shop: this.shop || rel.shop || 'unknown',
        isActive: rel.isActive ?? true,
        createdAt: rel.createdAt || new Date(),
        updatedAt: rel.updatedAt || new Date(),
      }));

      const result = await prisma.productDiscount.createMany({
        data
      });

      this.logger.info('Bulk created product-discount relationships', { 
        count: result.count,
        shop: this.shop 
      });

      // Return the created relationships
      return await prisma.productDiscount.findMany({
        where: {
          productId: { in: relationships.map(r => r.productId!) },
          discountId: { in: relationships.map(r => r.discountId!) },
          ...(this.shop ? { shop: this.shop } : {}),
        },
        include: {
          product: true,
          discount: true,
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountRepository.createBulk', 
        count: relationships.length,
        shop: this.shop 
      });
      throw error;
    }
  }

  async deleteByProductId(productId: number): Promise<number> {
    try {
      const result = await prisma.productDiscount.deleteMany({
        where: { 
          productId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
      });
      
      this.logger.info('Deleted product-discount relationships by product ID', { 
        productId, 
        count: result.count,
        shop: this.shop 
      });
      
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.deleteByProductId', productId });
      throw error;
    }
  }

  async deleteByDiscountId(discountId: number): Promise<number> {
    try {
      const result = await prisma.productDiscount.deleteMany({
        where: { 
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
      });
      
      this.logger.info('Deleted product-discount relationships by discount ID', { 
        discountId, 
        count: result.count,
        shop: this.shop 
      });
      
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.deleteByDiscountId', discountId });
      throw error;
    }
  }

  // Status management
  async activateByProductId(productId: number): Promise<number> {
    try {
      const result = await prisma.productDiscount.updateMany({
        where: { 
          productId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        data: {
          isActive: true,
          updatedAt: new Date(),
        },
      });
      
      this.logger.info('Activated product-discount relationships by product ID', { 
        productId, 
        count: result.count,
        shop: this.shop 
      });
      
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.activateByProductId', productId });
      throw error;
    }
  }

  async deactivateByProductId(productId: number): Promise<number> {
    try {
      const result = await prisma.productDiscount.updateMany({
        where: { 
          productId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });
      
      this.logger.info('Deactivated product-discount relationships by product ID', { 
        productId, 
        count: result.count,
        shop: this.shop 
      });
      
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.deactivateByProductId', productId });
      throw error;
    }
  }

  async activateByDiscountId(discountId: number): Promise<number> {
    try {
      const result = await prisma.productDiscount.updateMany({
        where: { 
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        data: {
          isActive: true,
          updatedAt: new Date(),
        },
      });
      
      this.logger.info('Activated product-discount relationships by discount ID', { 
        discountId, 
        count: result.count,
        shop: this.shop 
      });
      
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.activateByDiscountId', discountId });
      throw error;
    }
  }

  async deactivateByDiscountId(discountId: number): Promise<number> {
    try {
      const result = await prisma.productDiscount.updateMany({
        where: { 
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });
      
      this.logger.info('Deactivated product-discount relationships by discount ID', { 
        discountId, 
        count: result.count,
        shop: this.shop 
      });
      
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.deactivateByDiscountId', discountId });
      throw error;
    }
  }

  // Query operations
  async findActiveByShop(shop: string): Promise<ProductDiscount[]> {
    try {
      return await prisma.productDiscount.findMany({
        where: { 
          shop,
          isActive: true,
        },
        include: {
          product: true,
          discount: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findActiveByShop', shop });
      throw error;
    }
  }

  async countByDiscountId(discountId: number): Promise<number> {
    try {
      return await prisma.productDiscount.count({
        where: { 
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.countByDiscountId', discountId });
      throw error;
    }
  }

  async countByProductId(productId: number): Promise<number> {
    try {
      return await prisma.productDiscount.count({
        where: { 
          productId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.countByProductId', productId });
      throw error;
    }
  }

  // Advanced queries with relationships
  async findProductsWithDiscount(discountId: number): Promise<Product[]> {
    try {
      const relationships = await prisma.productDiscount.findMany({
        where: { 
          discountId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        include: {
          product: true,
        },
      });

      return relationships.map(rel => rel.product);
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findProductsWithDiscount', discountId });
      throw error;
    }
  }

  async findDiscountsForProduct(productId: number): Promise<DiscountMetafieldRule[]> {
    try {
      const relationships = await prisma.productDiscount.findMany({
        where: { 
          productId,
          ...(this.shop ? { shop: this.shop } : {}),
        },
        include: {
          discount: true,
        },
      });

      return relationships.map(rel => rel.discount);
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.findDiscountsForProduct', productId });
      throw error;
    }
  }

  // Statistics
  async getStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
  }> {
    try {
      const whereClause = this.shop ? { shop: this.shop } : {};
      
      const [total, active, inactive] = await Promise.all([
        prisma.productDiscount.count({ where: whereClause }),
        prisma.productDiscount.count({ where: { ...whereClause, isActive: true } }),
        prisma.productDiscount.count({ where: { ...whereClause, isActive: false } }),
      ]);

      return { total, active, inactive };
    } catch (error) {
      this.logger.error(error as Error, { scope: 'ProductDiscountRepository.getStatistics' });
      throw error;
    }
  }
}
