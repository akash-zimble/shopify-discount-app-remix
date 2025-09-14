import { 
  IProductDiscountService,
  IProductService,
  IDiscountService
} from './interfaces/IDiscountService';
import { 
  ProductDiscount, 
  ProductDiscountInput, 
  ProductDiscountWithDetails,
  BulkOperationResult,
  SyncResult,
  RelationshipStatistics
} from '../types/product-discount.types';
import { IProductDiscountRepository } from './interfaces/IRepository';
import { Logger } from '../utils/logger.server';
import { validationService } from './validation.service';

/**
 * ProductDiscount service implementation
 * Handles all business logic for product-discount relationships
 */
export class ProductDiscountService implements IProductDiscountService {
  constructor(
    private productDiscountRepository: IProductDiscountRepository,
    private productService: IProductService,
    private discountService: IDiscountService | null,
    private logger: Logger,
    private shop: string
  ) {}

  // Core relationship management
  async createRelationship(productId: number, discountId: number): Promise<ProductDiscount> {
    try {
      this.logger.info('Creating product-discount relationship', { productId, discountId, shop: this.shop });

      // Validate product exists
      const product = await this.productService.getProductByInternalId(productId);
      if (!product) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      // Validate discount exists
      if (this.discountService) {
        // We could add a method to validate discount exists
        // For now, we'll check if the relationship already exists
      }
      const existing = await this.productDiscountRepository.findByProductAndDiscount(productId, discountId);
      if (existing) {
        throw new Error(`Relationship already exists between product ${productId} and discount ${discountId}`);
      }

      // Create relationship
      const relationship = await this.productDiscountRepository.create({
        productId,
        discountId,
        shop: this.shop,
        isActive: true
      });

      // Sync with product metafields
      await this.syncWithProductMetafields(productId);

      this.logger.info('Successfully created product-discount relationship', { 
        relationshipId: relationship.id,
        productId, 
        discountId 
      });

      return relationship;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.createRelationship',
        productId, 
        discountId 
      });
      throw error;
    }
  }

  async removeRelationship(productId: number, discountId: number): Promise<boolean> {
    try {
      this.logger.info('Removing product-discount relationship', { productId, discountId, shop: this.shop });

      // Find existing relationship
      const existing = await this.productDiscountRepository.findByProductAndDiscount(productId, discountId);
      if (!existing) {
        this.logger.warn('Relationship not found for removal', { productId, discountId });
        return false;
      }

      // Remove relationship
      const deleted = await this.productDiscountRepository.delete(existing.id);
      
      if (deleted) {
        // Sync with product metafields
        await this.syncWithProductMetafields(productId);
        
        this.logger.info('Successfully removed product-discount relationship', { 
          relationshipId: existing.id,
          productId, 
          discountId 
        });
      }

      return deleted;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.removeRelationship',
        productId, 
        discountId 
      });
      throw error;
    }
  }

  async toggleRelationship(productId: number, discountId: number): Promise<ProductDiscount | null> {
    try {
      this.logger.info('Toggling product-discount relationship', { productId, discountId, shop: this.shop });

      // Check if relationship exists
      const existing = await this.productDiscountRepository.findByProductAndDiscount(productId, discountId);
      
      if (existing) {
        // Remove existing relationship
        await this.removeRelationship(productId, discountId);
        return null;
      } else {
        // Create new relationship
        return await this.createRelationship(productId, discountId);
      }
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.toggleRelationship',
        productId, 
        discountId 
      });
      throw error;
    }
  }

  // Bulk operations
  async createBulkRelationships(relationships: ProductDiscountInput[]): Promise<BulkOperationResult> {
    try {
      this.logger.info('Creating bulk product-discount relationships', { 
        count: relationships.length, 
        shop: this.shop 
      });

      const result: BulkOperationResult = {
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        errorDetails: []
      };

      // Validate all inputs first
      const validRelationships: ProductDiscountInput[] = [];
      
      for (const rel of relationships) {
        try {
          // Check if relationship already exists
          const existing = await this.productDiscountRepository.findByProductAndDiscount(rel.productId, rel.discountId);
          if (existing) {
            
            // If relationship exists but is inactive, update it to active
            if (!existing.isActive) {
              const updated = await this.productDiscountRepository.update(existing.id, {
                isActive: true,
                updatedAt: new Date()
              });
              if (updated) {
                result.updated++;
              } else {
                result.errors++;
                result.errorDetails.push({
                  input: rel,
                  error: 'Failed to reactivate existing relationship'
                });
              }
            } else {
              // Relationship already exists and is active
              result.skipped++;
            }
            continue;
          }

          // Validate product exists
          const product = await this.productService.getProductByInternalId(rel.productId);
          if (!product) {
            result.errors++;
            result.errorDetails.push({
              input: rel,
              error: `Product with ID ${rel.productId} not found`
            });
            continue;
          }

          validRelationships.push(rel);
        } catch (error) {
          result.errors++;
          result.errorDetails.push({
            input: rel,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Create valid relationships in bulk
      if (validRelationships.length > 0) {
        const created = await this.productDiscountRepository.createBulk(
          validRelationships.map(rel => ({
            productId: rel.productId,
            discountId: rel.discountId,
            shop: this.shop,
            isActive: rel.isActive ?? true
          }))
        );
        
        result.created = created.length;
      }

      result.success = result.errors === 0;

      this.logger.info('Bulk relationship creation completed', { 
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.createBulkRelationships',
        count: relationships.length
      });
      throw error;
    }
  }

  async removeBulkRelationships(relationships: ProductDiscountInput[]): Promise<BulkOperationResult> {
    try {
      this.logger.info('Deactivating bulk product-discount relationships', { 
        count: relationships.length, 
        shop: this.shop 
      });

      const result: BulkOperationResult = {
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        errorDetails: []
      };

      for (const rel of relationships) {
        try {
          const existing = await this.productDiscountRepository.findByProductAndDiscount(rel.productId, rel.discountId);
          if (!existing) {
            result.skipped++;
            continue;
          }

          
          const updated = await this.productDiscountRepository.update(existing.id, {
            isActive: false,
            updatedAt: new Date()
          });
          if (updated) {
            result.updated++; // Using updated count for deactivated items
          } else {
            result.errors++;
            result.errorDetails.push({
              input: rel,
              error: 'Failed to deactivate relationship'
            });
          }
        } catch (error) {
          result.errors++;
          result.errorDetails.push({
            input: rel,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      result.success = result.errors === 0;

      this.logger.info('Bulk relationship deactivation completed', { 
        deactivated: result.updated,
        skipped: result.skipped,
        errors: result.errors
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.removeBulkRelationships',
        count: relationships.length
      });
      throw error;
    }
  }

  async syncProductDiscounts(productId: number, discountIds: number[]): Promise<SyncResult> {
    try {
      this.logger.info('Syncing product discounts', { productId, discountIds, shop: this.shop });

      const result: SyncResult = {
        success: true,
        added: 0,
        removed: 0,
        errors: 0,
        errorDetails: []
      };

      // Get current relationships
      const currentRelationships = await this.productDiscountRepository.findByProductId(productId);
      const currentDiscountIds = currentRelationships.map(rel => rel.discountId);

      // Find relationships to add
      const toAdd = discountIds.filter(id => !currentDiscountIds.includes(id));
      
      // Find relationships to remove
      const toRemove = currentDiscountIds.filter(id => !discountIds.includes(id));

      // Add new relationships
      if (toAdd.length > 0) {
        const addInputs: ProductDiscountInput[] = toAdd.map(discountId => ({
          productId,
          discountId,
          isActive: true
        }));
        
        const addResult = await this.createBulkRelationships(addInputs);
        result.added = addResult.created;
        result.errors += addResult.errors;
        result.errorDetails.push(...addResult.errorDetails.map(detail => 
          `Add failed: ${detail.error}`
        ));
      }

      // Remove old relationships
      if (toRemove.length > 0) {
        const removeInputs: ProductDiscountInput[] = toRemove.map(discountId => ({
          productId,
          discountId
        }));
        
        const removeResult = await this.removeBulkRelationships(removeInputs);
        result.removed = removeResult.updated;
        result.errors += removeResult.errors;
        result.errorDetails.push(...removeResult.errorDetails.map(detail => 
          `Remove failed: ${detail.error}`
        ));
      }

      // Sync with product metafields
      await this.syncWithProductMetafields(productId);

      result.success = result.errors === 0;

      this.logger.info('Product discount sync completed', { 
        productId,
        added: result.added,
        removed: result.removed,
        errors: result.errors
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.syncProductDiscounts',
        productId,
        discountIds
      });
      throw error;
    }
  }

  async syncDiscountProducts(discountId: number, productIds: number[]): Promise<SyncResult> {
    try {
      this.logger.info('Syncing discount products', { discountId, productIds, shop: this.shop });

      const result: SyncResult = {
        success: true,
        added: 0,
        removed: 0,
        errors: 0,
        errorDetails: []
      };

      // Get current relationships
      const currentRelationships = await this.productDiscountRepository.findByDiscountId(discountId);
      const currentProductIds = currentRelationships.map(rel => rel.productId);

      // Find relationships to add
      const toAdd = productIds.filter(id => !currentProductIds.includes(id));
      
      // Find relationships to remove
      const toRemove = currentProductIds.filter(id => !productIds.includes(id));

      // Add new relationships
      if (toAdd.length > 0) {
        const addInputs: ProductDiscountInput[] = toAdd.map(productId => ({
          productId,
          discountId,
          isActive: true
        }));
        
        const addResult = await this.createBulkRelationships(addInputs);
        result.added = addResult.created;
        result.errors += addResult.errors;
        result.errorDetails.push(...addResult.errorDetails.map(detail => 
          `Add failed: ${detail.error}`
        ));
      }

      // Remove old relationships
      if (toRemove.length > 0) {
        const removeInputs: ProductDiscountInput[] = toRemove.map(productId => ({
          productId,
          discountId
        }));
        
        const removeResult = await this.removeBulkRelationships(removeInputs);
        result.removed = removeResult.updated;
        result.errors += removeResult.errors;
        result.errorDetails.push(...removeResult.errorDetails.map(detail => 
          `Remove failed: ${detail.error}`
        ));
      }

      // Sync with discount metafields
      await this.syncWithDiscountMetafields(discountId);

      result.success = result.errors === 0;

      this.logger.info('Discount product sync completed', { 
        discountId,
        added: result.added,
        removed: result.removed,
        errors: result.errors
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.syncDiscountProducts',
        discountId,
        productIds
      });
      throw error;
    }
  }

  // Query operations
  async getProductDiscounts(productId: number): Promise<ProductDiscountWithDetails[]> {
    try {
      const relationships = await this.productDiscountRepository.findByProductId(productId);
      return relationships as ProductDiscountWithDetails[];
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.getProductDiscounts',
        productId 
      });
      throw error;
    }
  }

  async getDiscountProducts(discountId: number): Promise<ProductDiscountWithDetails[]> {
    try {
      const relationships = await this.productDiscountRepository.findByDiscountId(discountId);
      return relationships as ProductDiscountWithDetails[];
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.getDiscountProducts',
        discountId 
      });
      throw error;
    }
  }

  async getActiveRelationships(shop?: string): Promise<ProductDiscountWithDetails[]> {
    try {
      const targetShop = shop || this.shop;
      const relationships = await this.productDiscountRepository.findActiveByShop(targetShop);
      return relationships as ProductDiscountWithDetails[];
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.getActiveRelationships',
        shop: shop || this.shop
      });
      throw error;
    }
  }

  // Status management
  async activateProductDiscounts(productId: number): Promise<number> {
    try {
      const count = await this.productDiscountRepository.activateByProductId(productId);
      await this.syncWithProductMetafields(productId);
      
      this.logger.info('Activated product discounts', { productId, count });
      return count;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.activateProductDiscounts',
        productId 
      });
      throw error;
    }
  }

  async deactivateProductDiscounts(productId: number): Promise<number> {
    try {
      const count = await this.productDiscountRepository.deactivateByProductId(productId);
      await this.syncWithProductMetafields(productId);
      
      this.logger.info('Deactivated product discounts', { productId, count });
      return count;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.deactivateProductDiscounts',
        productId 
      });
      throw error;
    }
  }

  async activateDiscountProducts(discountId: number): Promise<number> {
    try {
      const count = await this.productDiscountRepository.activateByDiscountId(discountId);
      await this.syncWithDiscountMetafields(discountId);
      
      this.logger.info('Activated discount products', { discountId, count });
      return count;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.activateDiscountProducts',
        discountId 
      });
      throw error;
    }
  }

  async deactivateDiscountProducts(discountId: number): Promise<number> {
    try {
      const count = await this.productDiscountRepository.deactivateByDiscountId(discountId);
      await this.syncWithDiscountMetafields(discountId);
      
      this.logger.info('Deactivated discount products', { discountId, count });
      return count;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.deactivateDiscountProducts',
        discountId 
      });
      throw error;
    }
  }

  // Integration with existing services
  async syncWithProductMetafields(productId: number): Promise<boolean> {
    try {
      // Get all active relationships for the product
      const relationships = await this.productDiscountRepository.findByProductId(productId);
      const activeRelationships = relationships.filter(rel => rel.isActive);
      
      // Build metafield data
      const metafieldData = activeRelationships.map(rel => ({
        discountId: rel.discount?.discountId || '',
        discountTitle: rel.discount?.discountTitle || '',
        discountType: rel.discount?.discountType || '',
        discountValue: rel.discount?.discountValue || '',
        discountValueType: rel.discount?.discountValueType || '',
        status: rel.discount?.status || '',
        startDate: rel.discount?.startDate || null,
        endDate: rel.discount?.endDate || null,
        createdAt: rel.createdAt
      }));

      // Update product metafield
      const metafieldJson = JSON.stringify(metafieldData);
      const success = await this.productService.updateProductActiveDiscounts(productId.toString(), metafieldJson);
      
      this.logger.info('Synced product metafields', { 
        productId, 
        relationshipsCount: activeRelationships.length,
        success 
      });
      
      return success;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.syncWithProductMetafields',
        productId 
      });
      return false;
    }
  }

  async syncWithDiscountMetafields(discountId: number): Promise<boolean> {
    try {
      // Get all active relationships for the discount
      const relationships = await this.productDiscountRepository.findByDiscountId(discountId);
      const activeRelationships = relationships.filter(rel => rel.isActive);
      
      // Update discount products count
      // Note: This would require adding a method to DiscountService to update productsCount
      // For now, we'll just log the count
      this.logger.info('Synced discount metafields', { 
        discountId, 
        productsCount: activeRelationships.length
      });
      
      return true;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.syncWithDiscountMetafields',
        discountId 
      });
      return false;
    }
  }

  // Statistics and reporting
  async getRelationshipStatistics(shop?: string): Promise<RelationshipStatistics> {
    try {
      const targetShop = shop || this.shop;
      const stats = await this.productDiscountRepository.getStatistics();
      
      // Get additional statistics
      const allRelationships = await this.productDiscountRepository.findAll();
      const shopRelationships = targetShop ? 
        allRelationships.filter(rel => rel.shop === targetShop) : 
        allRelationships;
      
      const uniqueProducts = new Set(shopRelationships.map(rel => rel.productId)).size;
      const uniqueDiscounts = new Set(shopRelationships.map(rel => rel.discountId)).size;
      
      return {
        total: stats.total,
        active: stats.active,
        inactive: stats.inactive,
        productsWithDiscounts: uniqueProducts,
        discountsWithProducts: uniqueDiscounts
      };
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.getRelationshipStatistics',
        shop: shop || this.shop
      });
      throw error;
    }
  }

  async getProductDiscountCounts(productIds: number[]): Promise<Map<number, number>> {
    try {
      const counts = new Map<number, number>();
      
      for (const productId of productIds) {
        const count = await this.productDiscountRepository.countByProductId(productId);
        counts.set(productId, count);
      }
      
      return counts;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.getProductDiscountCounts',
        productIds
      });
      throw error;
    }
  }

  async getDiscountProductCounts(discountIds: number[]): Promise<Map<number, number>> {
    try {
      const counts = new Map<number, number>();
      
      for (const discountId of discountIds) {
        const count = await this.productDiscountRepository.countByDiscountId(discountId);
        counts.set(discountId, count);
      }
      
      return counts;
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'ProductDiscountService.getDiscountProductCounts',
        discountIds
      });
      throw error;
    }
  }
}
