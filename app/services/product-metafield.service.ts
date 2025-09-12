import { IProductMetafieldService, BulkUpdateResult } from './interfaces/IDiscountService';
import { IAdminClient } from './interfaces/IAdminClient';
import { Logger } from '../utils/logger.server';
import { validationService } from './validation.service';
import { ExtractedDiscountData } from './discountDataExtractor.server';
import { configurationService } from './configuration.service';

/**
 * Product metafield service implementation
 * Handles all product metafield operations for discount data
 */
export class ProductMetafieldService implements IProductMetafieldService {
  private readonly metafieldConfig = configurationService.getMetafieldConfig() as { namespace: string; key: string; type: string };

  constructor(
    private adminClient: IAdminClient,
    private logger: Logger
  ) {}

  async updateProductMetafield(productId: string, discountData: ExtractedDiscountData): Promise<boolean> {
    try {
      // Validate inputs
      const productValidation = validationService.validateProductId(productId);
      if (!productValidation.isValid) {
        this.logger.error('Invalid product ID', { productId, errors: productValidation.errors });
        return false;
      }

      const discountValidation = validationService.validateDiscountData(discountData);
      if (!discountValidation.isValid) {
        this.logger.error('Invalid discount data', { discountData, errors: discountValidation.errors });
        return false;
      }

      if (!discountData.id) {
        this.logger.error('Attempting to update metafield with empty discount ID', { productId, discountData });
        return false;
      }

      // Get existing metafield value
      const existingMetafield = await this.getProductMetafield(productId);
      let discountArray: ExtractedDiscountData[] = [];

      if (existingMetafield) {
        try {
          discountArray = JSON.parse(existingMetafield) || [];
        } catch (error) {
          this.logger.warn('Failed to parse existing metafield, starting fresh', {
            productId,
            error: error instanceof Error ? error.message : String(error),
          });
          discountArray = [];
        }
      }

      // Remove any existing entry for this discount (in case it's an update)
      discountArray = discountArray.filter(d => d.id !== discountData.id);

      // Add the new/updated discount data
      discountArray.push(discountData);

      // Update the metafield
      const response = await this.adminClient.executeMutation(`
        mutation updateProductMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          metafields: [{
            ownerId: productId,
            namespace: this.metafieldConfig.namespace,
            key: this.metafieldConfig.key,
            value: JSON.stringify(discountArray),
            type: this.metafieldConfig.type,
          }],
        },
      });

      const result = response.data?.metafieldsSet;
      if (result?.userErrors?.length > 0) {
        this.logger.error('Metafield update errors', {
          userErrors: result.userErrors,
          productId,
          discountId: discountData.id,
        });
        return false;
      }

      this.logger.info('Updated product metafield', {
        productId,
        discountId: discountData.id,
        discountCount: discountArray.length,
      });
      return true;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductMetafieldService.updateProductMetafield',
        productId,
        discountId: discountData.id,
      });
      return false;
    }
  }

  async removeDiscountFromProduct(productId: string, discountId: string): Promise<boolean> {
    try {
      // Validate inputs
      const productValidation = validationService.validateProductId(productId);
      if (!productValidation.isValid) {
        this.logger.error('Invalid product ID', { productId, errors: productValidation.errors });
        return false;
      }

      const discountValidation = validationService.validateDiscountId(discountId);
      if (!discountValidation.isValid) {
        this.logger.error('Invalid discount ID', { discountId, errors: discountValidation.errors });
        return false;
      }

      const existingMetafield = await this.getProductMetafield(productId);
      if (!existingMetafield) {
        return true; // Nothing to remove
      }

      let discountArray: ExtractedDiscountData[] = [];
      try {
        discountArray = JSON.parse(existingMetafield) || [];
      } catch (error) {
        this.logger.warn('Failed to parse metafield, considering it empty', {
          productId,
          error: error instanceof Error ? error.message : String(error),
        });
        return true; // Invalid JSON, consider it empty
      }

      // Remove the discount from the array
      const filteredArray = discountArray.filter(d => d.id !== discountId);

      if (filteredArray.length === discountArray.length) {
        return true; // Discount wasn't in the array anyway
      }

      // Update the metafield with the filtered array
      const response = await this.adminClient.executeMutation(`
        mutation updateProductMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          metafields: [{
            ownerId: productId,
            namespace: this.metafieldConfig.namespace,
            key: this.metafieldConfig.key,
            value: JSON.stringify(filteredArray),
            type: this.metafieldConfig.type,
          }],
        },
      });

      const result = response.data?.metafieldsSet;
      if (result?.userErrors?.length > 0) {
        this.logger.error('Metafield removal errors', {
          userErrors: result.userErrors,
          productId,
          discountId,
        });
        return false;
      }

      this.logger.info('Removed discount from product metafield', {
        productId,
        discountId,
        remainingDiscounts: filteredArray.length,
      });
      return true;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductMetafieldService.removeDiscountFromProduct',
        productId,
        discountId,
      });
      return false;
    }
  }

  async getProductMetafield(productId: string): Promise<string | null> {
    try {
      const productValidation = validationService.validateProductId(productId);
      if (!productValidation.isValid) {
        this.logger.error('Invalid product ID', { productId, errors: productValidation.errors });
        return null;
      }

      const response = await this.adminClient.executeQuery(`
        query getProductMetafield($productId: ID!) {
          product(id: $productId) {
            metafield(namespace: "${this.metafieldConfig.namespace}", key: "${this.metafieldConfig.key}") {
              value
            }
          }
        }
      `, { variables: { productId } });

      const value = response.data?.product?.metafield?.value || null;
      this.logger.debug('Fetched product metafield', {
        productId,
        hasValue: Boolean(value),
      });
      return value;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductMetafieldService.getProductMetafield',
        productId,
      });
      return null;
    }
  }

  async updateMultipleProductMetafields(
    productIds: string[],
    discountData: ExtractedDiscountData
  ): Promise<BulkUpdateResult> {
    const errors: Array<{ productId: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    // Validate inputs
    const productIdsValidation = validationService.validateProductIds(productIds);
    if (!productIdsValidation.isValid) {
      this.logger.error('Invalid product IDs', { errors: productIdsValidation.errors });
      return {
        successCount: 0,
        failureCount: productIds.length,
        errors: productIds.map(id => ({ productId: id, error: 'Invalid product ID format' })),
        totalProcessed: productIds.length,
      };
    }

    const discountValidation = validationService.validateDiscountData(discountData);
    if (!discountValidation.isValid) {
      this.logger.error('Invalid discount data', { errors: discountValidation.errors });
      return {
        successCount: 0,
        failureCount: productIds.length,
        errors: productIds.map(id => ({ productId: id, error: 'Invalid discount data' })),
        totalProcessed: productIds.length,
      };
    }

    const maxProducts = configurationService.get('app.maxProductsPerBatch', 10);
    const rateLimitDelay = configurationService.get('app.rateLimitDelay', 500);
    const productsToProcess = productIds.slice(0, maxProducts);

    for (const productId of productsToProcess) {
      try {
        const success = await this.updateProductMetafield(productId, discountData);
        if (success) {
          successCount++;
        } else {
          failureCount++;
          errors.push({ productId, error: 'Failed to update metafield' });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
      } catch (error) {
        failureCount++;
        errors.push({
          productId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info('Bulk metafield update completed', {
      totalProcessed: productsToProcess.length,
      successCount,
      failureCount,
      discountId: discountData.id,
    });

    return {
      successCount,
      failureCount,
      errors,
      totalProcessed: productsToProcess.length,
    };
  }

  async removeDiscountFromMultipleProducts(
    productIds: string[],
    discountId: string
  ): Promise<BulkUpdateResult> {
    const errors: Array<{ productId: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    // Validate inputs
    const productIdsValidation = validationService.validateProductIds(productIds);
    if (!productIdsValidation.isValid) {
      this.logger.error('Invalid product IDs', { errors: productIdsValidation.errors });
      return {
        successCount: 0,
        failureCount: productIds.length,
        errors: productIds.map(id => ({ productId: id, error: 'Invalid product ID format' })),
        totalProcessed: productIds.length,
      };
    }

    const discountValidation = validationService.validateDiscountId(discountId);
    if (!discountValidation.isValid) {
      this.logger.error('Invalid discount ID', { errors: discountValidation.errors });
      return {
        successCount: 0,
        failureCount: productIds.length,
        errors: productIds.map(id => ({ productId: id, error: 'Invalid discount ID format' })),
        totalProcessed: productIds.length,
      };
    }

    const maxProducts = configurationService.get('app.maxProductsPerBatch', 20);
    const rateLimitDelay = configurationService.get('app.rateLimitDelay', 200);
    const productsToProcess = productIds.slice(0, maxProducts);

    for (const productId of productsToProcess) {
      try {
        const success = await this.removeDiscountFromProduct(productId, discountId);
        if (success) {
          successCount++;
        } else {
          failureCount++;
          errors.push({ productId, error: 'Failed to remove discount from metafield' });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
      } catch (error) {
        failureCount++;
        errors.push({
          productId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info('Bulk discount removal completed', {
      totalProcessed: productsToProcess.length,
      successCount,
      failureCount,
      discountId,
    });

    return {
      successCount,
      failureCount,
      errors,
      totalProcessed: productsToProcess.length,
    };
  }
}
