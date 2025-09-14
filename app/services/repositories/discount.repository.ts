import prisma from '../../db.server';
import { IDiscountRepository } from '../interfaces/IRepository';
import { DiscountMetafieldRule } from '@prisma/client';
import { Logger } from '../../utils/logger.server';

/**
 * Discount repository implementation
 * Handles all database operations for discount metafield rules
 */
export class DiscountRepository implements IDiscountRepository {
  constructor(private logger: Logger, private shop?: string) {}

  async findById(id: number): Promise<DiscountMetafieldRule | null> {
    try {
      return await prisma.discountMetafieldRule.findUnique({
        where: { id },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.findById', id });
      throw error;
    }
  }

  async findAll(): Promise<DiscountMetafieldRule[]> {
    try {
      return await prisma.discountMetafieldRule.findMany({
        where: this.shop ? { shop: this.shop } : {},
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.findAll', shop: this.shop });
      throw error;
    }
  }

  async create(data: Partial<DiscountMetafieldRule>): Promise<DiscountMetafieldRule> {
    try {
      return await prisma.discountMetafieldRule.create({
        data: {
          shop: this.shop || 'unknown',
          discountId: data.discountId!,
          discountType: data.discountType!,
          discountTitle: data.discountTitle!,
          metafieldNamespace: data.metafieldNamespace || 'discount_manager',
          metafieldKey: data.metafieldKey || 'active_discounts',
          metafieldValue: data.metafieldValue!,
          isActive: data.isActive ?? true,
          discountValue: data.discountValue,
          discountValueType: data.discountValueType,
          status: data.status || 'ACTIVE',
          startDate: data.startDate,
          endDate: data.endDate,
          productsCount: data.productsCount || 0,
          lastRan: data.lastRan || new Date(),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.create', data, shop: this.shop });
      throw error;
    }
  }

  async update(id: number, data: Partial<DiscountMetafieldRule>): Promise<DiscountMetafieldRule> {
    try {
      return await prisma.discountMetafieldRule.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.update', id, data });
      throw error;
    }
  }

  async delete(id: number): Promise<boolean> {
    try {
      await prisma.discountMetafieldRule.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.delete', id });
      return false;
    }
  }

  async findByDiscountId(discountId: string): Promise<DiscountMetafieldRule | null> {
    try {
      return await prisma.discountMetafieldRule.findFirst({
        where: { discountId },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.findByDiscountId', discountId });
      throw error;
    }
  }

  async findActiveDiscounts(): Promise<DiscountMetafieldRule[]> {
    try {
      return await prisma.discountMetafieldRule.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.findActiveDiscounts' });
      throw error;
    }
  }

  async updateByDiscountId(discountId: string, data: Partial<DiscountMetafieldRule>): Promise<number> {
    try {
      const result = await prisma.discountMetafieldRule.updateMany({
        where: { discountId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.updateByDiscountId', discountId, data });
      throw error;
    }
  }

  async deactivateByDiscountId(discountId: string): Promise<number> {
    try {
      const result = await prisma.discountMetafieldRule.updateMany({
        where: { discountId },
        data: {
          isActive: false,
          status: 'DELETED',
          lastRan: new Date(),
          updatedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.deactivateByDiscountId', discountId });
      throw error;
    }
  }

  async updateProductsCount(discountId: string, count: number): Promise<void> {
    try {
      await prisma.discountMetafieldRule.updateMany({
        where: { discountId },
        data: {
          productsCount: count,
          lastRan: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.updateProductsCount', discountId, count });
      throw error;
    }
  }

  /**
   * Get discount statistics
   */
  async getStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
    expired: number;
  }> {
    try {
      const [total, active, inactive, expired] = await Promise.all([
        prisma.discountMetafieldRule.count(),
        prisma.discountMetafieldRule.count({ where: { isActive: true } }),
        prisma.discountMetafieldRule.count({ where: { isActive: false } }),
        prisma.discountMetafieldRule.count({ 
          where: { 
            status: 'EXPIRED',
            isActive: false 
          } 
        }),
      ]);

      return { total, active, inactive, expired };
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.getStatistics' });
      throw error;
    }
  }

  /**
   * Find discounts by status
   */
  async findByStatus(status: string): Promise<DiscountMetafieldRule[]> {
    try {
      return await prisma.discountMetafieldRule.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.findByStatus', status });
      throw error;
    }
  }

  /**
   * Find expired discounts
   */
  async findExpiredDiscounts(): Promise<DiscountMetafieldRule[]> {
    try {
      const now = new Date();
      return await prisma.discountMetafieldRule.findMany({
        where: {
          isActive: true,
          endDate: {
            lt: now,
          },
        },
        orderBy: { endDate: 'asc' },
      });
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountRepository.findExpiredDiscounts' });
      throw error;
    }
  }
}
