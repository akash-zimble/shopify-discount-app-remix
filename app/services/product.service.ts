import { IProductService, Product, ProductFetchResult } from './interfaces/IDiscountService';
import { IAdminClient } from './interfaces/IAdminClient';
import { Logger } from '../utils/logger.server';
import { validationService } from './validation.service';
import { configurationService } from './configuration.service';
import prisma from '../db.server';
// Updated Prisma client with Product model - regenerated with shopifyId field

/**
 * Product service implementation
 * Handles all product-related operations including fetching from Shopify and database management
 */
export class ProductService implements IProductService {
  private readonly metafieldConfig = configurationService.getMetafieldConfig() as { namespace: string; key: string; type: string };

  constructor(
    private adminClient: IAdminClient,
    private logger: Logger,
    private shop: string
  ) {}

  /**
   * Extract numeric ID from Shopify GID format or handle numeric IDs
   * e.g., "gid://shopify/Product/8579006202034" -> "8579006202034"
   * e.g., 8579006202034 -> "8579006202034"
   */
  private extractShopifyId(gid: string | number): string {
    // Convert to string if it's a number
    const gidStr = String(gid);
    
    if (gidStr.startsWith('gid://shopify/Product/')) {
      return gidStr.replace('gid://shopify/Product/', '');
    }
    return gidStr; // Return as-is if not in GID format
  }

  async fetchAndSaveAllProducts(): Promise<ProductFetchResult> {
    try {
      this.logger.info('Starting to fetch all products from Shopify');

      let allProducts: Product[] = [];
      let hasNextPage = true;
      let cursor: string | null = null;
      let totalFound = 0;
      let processed = 0;
      let skipped = 0;
      let errors = 0;

      // Fetch products in batches using pagination
      while (hasNextPage) {
        const batchResult = await this.fetchProductsBatch(cursor);
        
        if (!batchResult.success) {
          this.logger.error('Failed to fetch products batch', { cursor, error: batchResult.error });
          errors++;
          break;
        }

        const { products, nextCursor, hasNext } = batchResult;
        totalFound += products.length;

        // Process each product in the batch
        for (const shopifyProduct of products) {
          try {
            const productData = await this.transformShopifyProduct(shopifyProduct);
            const saved = await this.saveOrUpdateProduct(productData);
            
            if (saved) {
              processed++;
              allProducts.push(productData);
            } else {
              skipped++;
            }
          } catch (error) {
            this.logger.error('Error processing product', {
              productId: shopifyProduct.id,
              error: error instanceof Error ? error.message : String(error),
            });
            errors++;
          }
        }

        cursor = nextCursor;
        hasNextPage = hasNext;

        // Rate limiting between batches
        const rateLimitDelay = configurationService.get('app.rateLimitDelay', 1000);
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
      }

      this.logger.info('Product fetch completed', {
        totalFound,
        processed,
        skipped,
        errors,
      });

      return {
        success: errors === 0,
        totalFound,
        processed,
        skipped,
        errors,
        products: allProducts,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.fetchAndSaveAllProducts',
      });
      return {
        success: false,
        totalFound: 0,
        processed: 0,
        skipped: 0,
        errors: 1,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getAllProducts(): Promise<Product[]> {
    try {
      const products = await prisma.product.findMany({
        where: { shop: this.shop },
        orderBy: { updatedAt: 'desc' },
      });

      this.logger.debug('Retrieved products from database', { count: products.length, shop: this.shop });
      return products;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.getAllProducts',
        shop: this.shop,
      });
      return [];
    }
  }

  async getProductById(shopifyId: string): Promise<Product | null> {
    try {
      const productValidation = validationService.validateProductId(shopifyId);
      if (!productValidation.isValid) {
        this.logger.error('Invalid product ID', { shopifyId, errors: productValidation.errors });
        return null;
      }

      const product = await prisma.product.findUnique({
        where: { 
          shop_shopifyId: {
            shop: this.shop,
            shopifyId: this.extractShopifyId(shopifyId)
          }
        },
      });

      this.logger.debug('Retrieved product by Shopify ID', { shopifyId, found: !!product });
      return product;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.getProductById',
        shopifyId,
      });
      return null;
    }
  }

  async updateProductActiveDiscounts(shopifyId: string, activeDiscounts: string): Promise<boolean> {
    try {
      const productValidation = validationService.validateProductId(shopifyId);
      if (!productValidation.isValid) {
        this.logger.error('Invalid product ID', { shopifyId, errors: productValidation.errors });
        return false;
      }

      await prisma.product.update({
        where: { 
          shop_shopifyId: {
            shop: this.shop,
            shopifyId: this.extractShopifyId(shopifyId)
          }
        },
        data: {
          activeDiscounts,
          updatedAt: new Date(),
        },
      });

      this.logger.info('Updated product active discounts', { shopifyId });
      return true;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.updateProductActiveDiscounts',
        shopifyId,
      });
      return false;
    }
  }

  async getProductsCount(): Promise<number> {
    try {
      const count = await prisma.product.count({
        where: { shop: this.shop },
      });
      this.logger.debug('Retrieved products count', { count });
      return count;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.getProductsCount',
      });
      return 0;
    }
  }

  async syncProductFromShopify(shopifyId: string): Promise<boolean> {
    try {
      const productValidation = validationService.validateProductId(shopifyId);
      if (!productValidation.isValid) {
        this.logger.error('Invalid product ID', { shopifyId, errors: productValidation.errors });
        return false;
      }

      // Convert to GID format for GraphQL query
      const productGid = shopifyId.startsWith('gid://') ? shopifyId : `gid://shopify/Product/${shopifyId}`;

      // Fetch single product from Shopify with complete data
      const response = await this.adminClient.executeQuery(`
        query getProduct($productId: ID!) {
          product(id: $productId) {
            id
            title
            handle
            description
            productType
            vendor
            status
            variants(first: 250) {
              edges {
                node {
                  id
                }
              }
            }
            images(first: 250) {
              edges {
                node {
                  id
                }
              }
            }
            tags
            metafield(namespace: "${this.metafieldConfig.namespace}", key: "${this.metafieldConfig.key}") {
              value
            }
          }
        }
      `, { variables: { productId: productGid } });

      const shopifyProduct = response.data?.product;
      if (!shopifyProduct) {
        this.logger.warn('Product not found in Shopify', { shopifyId });
        return false;
      }

      const productData = await this.transformShopifyProduct(shopifyProduct);
      const saved = await this.saveOrUpdateProduct(productData);

      this.logger.info('Synced product from Shopify', { shopifyId, saved });
      return saved;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.syncProductFromShopify',
        shopifyId,
      });
      return false;
    }
  }

  /**
   * Fetch a batch of products from Shopify using cursor-based pagination
   */
  private async fetchProductsBatch(cursor: string | null = null): Promise<{
    success: boolean;
    products: any[];
    nextCursor: string | null;
    hasNext: boolean;
    error?: string;
  }> {
    try {
      const query = `
        query getProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            edges {
              node {
                id
                title
                handle
                description
                productType
                vendor
                status
                variants(first: 1) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                images(first: 1) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                tags
                metafield(namespace: "${this.metafieldConfig.namespace}", key: "${this.metafieldConfig.key}") {
                  value
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const batchSize = configurationService.get('app.productsBatchSize', 50);
      const response = await this.adminClient.executeQuery(query, {
        variables: {
          first: batchSize,
          after: cursor,
        },
      });

      const productsData = response.data?.products;
      if (!productsData) {
        return {
          success: false,
          products: [],
          nextCursor: null,
          hasNext: false,
          error: 'No products data received',
        };
      }

      const products = productsData.edges.map((edge: any) => edge.node);
      const pageInfo = productsData.pageInfo;

      return {
        success: true,
        products,
        nextCursor: pageInfo.endCursor,
        hasNext: pageInfo.hasNextPage,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.fetchProductsBatch',
        cursor,
      });
      return {
        success: false,
        products: [],
        nextCursor: null,
        hasNext: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Transform Shopify product data to our Product interface
   * Handles both GraphQL responses and webhook payloads
   */
  private async transformShopifyProduct(shopifyProduct: any): Promise<Product> {
    // Handle different data structures (GraphQL vs webhook)
    const variantsCount = shopifyProduct.variants?.edges?.length || 
                         shopifyProduct.variants?.length || 
                         shopifyProduct.variants_count || 0;
    
    const imagesCount = shopifyProduct.images?.edges?.length || 
                       shopifyProduct.images?.length || 
                       shopifyProduct.images_count || 0;
    
    const tags = shopifyProduct.tags ? JSON.stringify(shopifyProduct.tags) : null;
    const activeDiscounts = shopifyProduct.metafield?.value || null;

    return {
      id: 0, // Will be set by database auto-increment
      shop: this.shop,
      shopifyId: this.extractShopifyId(shopifyProduct.id),
      title: shopifyProduct.title || '',
      handle: shopifyProduct.handle || '',
      description: shopifyProduct.description || null,
      productType: shopifyProduct.productType || shopifyProduct.product_type || null,
      vendor: shopifyProduct.vendor || null,
      status: shopifyProduct.status || 'ACTIVE',
      variantsCount,
      imagesCount,
      tags: tags || undefined,
      activeDiscounts: activeDiscounts || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastFetchedAt: new Date(),
    };
  }

  /**
   * Process product create webhook
   */
  async processProductCreate(payload: any): Promise<Product> {
    try {
      const shopifyId = this.extractShopifyId(payload.id);
      
      this.logger.info('Processing product create webhook', { 
        productId: payload.id,
        shopifyId,
        title: payload.title 
      });

      // Fetch complete product data from Shopify to ensure all fields are updated
      const success = await this.syncProductFromShopify(shopifyId);
      
      if (success) {
        // Get the updated product from database
        const productData = await this.getProductById(shopifyId);
        if (productData) {
          this.logger.info('Product created and synced successfully', {
            shopifyId: productData.shopifyId,
            title: productData.title,
            shop: productData.shop
          });
          return productData;
        } else {
          throw new Error('Product was synced but could not be retrieved from database');
        }
      } else {
        throw new Error('Failed to sync product from Shopify');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.processProductCreate',
        productId: payload.id,
        title: payload.title
      });
      throw error;
    }
  }

  /**
   * Process product update webhook
   */
  async processProductUpdate(payload: any): Promise<Product> {
    try {
      const shopifyId = this.extractShopifyId(payload.id);
      
      this.logger.info('Processing product update webhook', { 
        productId: payload.id,
        shopifyId,
        title: payload.title 
      });

      // Fetch complete product data from Shopify to ensure all fields are updated
      const success = await this.syncProductFromShopify(shopifyId);
      
      if (success) {
        // Get the updated product from database
        const productData = await this.getProductById(shopifyId);
        if (productData) {
          this.logger.info('Product updated and synced successfully', {
            shopifyId: productData.shopifyId,
            title: productData.title,
            shop: productData.shop
          });
          return productData;
        } else {
          throw new Error('Product was synced but could not be retrieved from database');
        }
      } else {
        throw new Error('Failed to sync product from Shopify');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.processProductUpdate',
        productId: payload.id,
        title: payload.title
      });
      throw error;
    }
  }

  /**
   * Process product delete webhook
   */
  async processProductDelete(payload: any): Promise<{ deleted: boolean; shopifyId: string }> {
    try {
      const shopifyId = this.extractShopifyId(payload.id);
      
      this.logger.info('Processing product delete webhook', { 
        productId: payload.id,
        shopifyId,
        title: payload.title 
      });

      // Delete the product from our database
      const deleted = await prisma.product.deleteMany({
        where: {
          shop: this.shop,
          shopifyId: shopifyId
        }
      });

      const success = deleted.count > 0;

      if (success) {
        this.logger.info('Product deleted successfully', {
          shopifyId,
          shop: this.shop
        });
      } else {
        this.logger.warn('Product not found in database for deletion', {
          shopifyId,
          shop: this.shop
        });
      }

      return { deleted: success, shopifyId };
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.processProductDelete',
        productId: payload.id,
        title: payload.title
      });
      throw error;
    }
  }

  /**
   * Save or update product in database
   */
  private async saveOrUpdateProduct(productData: Product): Promise<boolean> {
    try {
      await prisma.product.upsert({
        where: { 
          shop_shopifyId: {
            shop: productData.shop,
            shopifyId: productData.shopifyId
          }
        },
        update: {
          title: productData.title,
          handle: productData.handle,
          description: productData.description,
          productType: productData.productType,
          vendor: productData.vendor,
          status: productData.status,
          variantsCount: productData.variantsCount,
          imagesCount: productData.imagesCount,
          tags: productData.tags,
          activeDiscounts: productData.activeDiscounts,
          updatedAt: new Date(),
          lastFetchedAt: new Date(),
        },
        create: {
          shop: productData.shop,
          shopifyId: productData.shopifyId,
          title: productData.title,
          handle: productData.handle,
          description: productData.description,
          productType: productData.productType,
          vendor: productData.vendor,
          status: productData.status,
          variantsCount: productData.variantsCount,
          imagesCount: productData.imagesCount,
          tags: productData.tags,
          activeDiscounts: productData.activeDiscounts,
          createdAt: productData.createdAt,
          updatedAt: productData.updatedAt,
          lastFetchedAt: productData.lastFetchedAt,
        },
      });

      return true;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'ProductService.saveOrUpdateProduct',
        productId: productData.id,
      });
      return false;
    }
  }
}
