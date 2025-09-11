import prisma from "../db.server";
import type { Logger } from "../utils/logger.server";

export interface ProductData {
  id: string;
  title: string;
  handle: string;
  status: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  description?: string;
  descriptionHtml?: string;
  totalInventory?: number;
  price?: string;
  compareAtPrice?: string;
  currencyCode?: string;
  activeDiscounts?: string;
}

export class ProductService {
  private adminClient: any;
  private logger: Logger;

  constructor(adminClient: any, logger: Logger) {
    this.adminClient = adminClient;
    this.logger = logger;
  }

  /**
   * Sync a single product from Shopify to our database
   */
  async syncProduct(productId: string): Promise<boolean> {
    try {
      const response = await this.adminClient.graphql(`
        #graphql
        query getProduct($id: ID!) {
          product(id: $id) {
            id
            title
            handle
            status
            productType
            vendor
            tags
            createdAt
            updatedAt
            publishedAt
            description
            descriptionHtml
            totalInventory
            variants(first: 1) {
              edges {
                node {
                  price
                  compareAtPrice
                }
              }
            }
            metafields(first: 50) {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                  type
                }
              }
            }
          }
        }
      `, { variables: { id: productId } });

      const data = await response.json();
      const product = data.data?.product;

      if (!product) {
        this.logger.warn("Product not found", { productId });
        return false;
      }

      // Extract only the active_discounts metafield
      const metafields = product.metafields?.edges?.map((edge: any) => edge.node) || [];
      const activeDiscountsMetafield = metafields.find((metafield: any) => 
        metafield.namespace === 'discount_manager' && metafield.key === 'active_discounts'
      );
      const activeDiscounts = activeDiscountsMetafield ? activeDiscountsMetafield.value : null;
      
      // Get price from first variant
      const firstVariant = product.variants?.edges?.[0]?.node;
      const price = firstVariant?.price;
      const compareAtPrice = firstVariant?.compareAtPrice;
      const currencyCode = 'USD'; // Default currency since it's not available in variant

      // Upsert product
      await (prisma as any).product.upsert({
        where: { id: product.id },
        update: {
          title: product.title,
          handle: product.handle,
          status: product.status,
          productType: product.productType,
          vendor: product.vendor,
          tags: product.tags?.join(', '),
          updatedAt: new Date(product.updatedAt),
          publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
          description: product.description,
          descriptionHtml: product.descriptionHtml,
          totalInventory: product.totalInventory || 0,
          price: price,
          compareAtPrice: compareAtPrice,
          currencyCode: currencyCode,
          activeDiscounts: activeDiscounts,
          syncedAt: new Date(),
        },
        create: {
          id: product.id,
          title: product.title,
          handle: product.handle,
          status: product.status,
          productType: product.productType,
          vendor: product.vendor,
          tags: product.tags?.join(', '),
          createdAt: new Date(product.createdAt),
          updatedAt: new Date(product.updatedAt),
          publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
          description: product.description,
          descriptionHtml: product.descriptionHtml,
          totalInventory: product.totalInventory || 0,
          price: price,
          compareAtPrice: compareAtPrice,
          currencyCode: currencyCode,
          activeDiscounts: activeDiscounts,
          syncedAt: new Date(),
        }
      });

      this.logger.info("Product synced successfully", { productId, title: product.title });
      return true;

    } catch (error) {
      this.logger.error(error as Error, { scope: "syncProduct", productId });
      return false;
    }
  }

  /**
   * Sync multiple products by their IDs
   */
  async syncProducts(productIds: string[]): Promise<{ synced: number; failed: number; syncedIds: string[]; failedIds: string[] }> {
    let synced = 0;
    let failed = 0;
    const syncedIds: string[] = [];
    const failedIds: string[] = [];

    for (const productId of productIds) {
      const success = await this.syncProduct(productId);
      if (success) {
        synced++;
        syncedIds.push(productId);
      } else {
        failed++;
        failedIds.push(productId);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.logger.info("Product sync batch completed", { total: productIds.length, synced, failed, syncedIds, failedIds });
    return { synced, failed, syncedIds, failedIds };
  }

  /**
   * Get products associated with a specific discount
   */
  async getProductsForDiscount(discountId: string) {
    try {
      const products = await (prisma as any).product.findMany({
        where: {
          discounts: {
            some: {
              discountId: discountId
            }
          }
        },
        include: {
          discounts: {
            where: {
              discountId: discountId
            }
          }
        },
        orderBy: {
          title: 'asc'
        }
      });

      return products.map((product: any) => ({
        ...product,
        activeDiscounts: product.activeDiscounts ? JSON.parse(product.activeDiscounts) : [],
        associatedAt: product.discounts[0]?.createdAt
      }));

    } catch (error) {
      this.logger.error(error as Error, { scope: "getProductsForDiscount", discountId });
      return [];
    }
  }

  /**
   * Associate a product with a discount
   */
  async associateProductWithDiscount(productId: string, discountId: string): Promise<boolean> {
    try {
      // First check if the product exists in our database
      const existingProduct = await (prisma as any).product.findUnique({
        where: { id: productId }
      });

      if (!existingProduct) {
        this.logger.warn("Product not found in database, cannot create association", { productId, discountId });
        return false;
      }

      await (prisma as any).productDiscount.upsert({
        where: {
          productId_discountId: {
            productId,
            discountId
          }
        },
        update: {
          updatedAt: new Date()
        },
        create: {
          productId,
          discountId
        }
      });

      // Update product's last metafield update timestamp
      await (prisma as any).product.update({
        where: { id: productId },
        data: {
          lastMetafieldUpdate: new Date()
        }
      });

      this.logger.info("Product associated with discount", { productId, discountId });
      return true;

    } catch (error) {
      this.logger.error(error as Error, { scope: "associateProductWithDiscount", productId, discountId });
      return false;
    }
  }

  /**
   * Remove association between a product and discount
   */
  async removeProductFromDiscount(productId: string, discountId: string): Promise<boolean> {
    try {
      // Remove the association from ProductDiscount table
      await (prisma as any).productDiscount.deleteMany({
        where: {
          productId,
          discountId
        }
      });

      // Get current activeDiscounts and remove the discount
      const product = await (prisma as any).product.findUnique({
        where: { id: productId },
        select: { activeDiscounts: true }
      });

      if (product && product.activeDiscounts) {
        try {
          const activeDiscounts = JSON.parse(product.activeDiscounts);
          const updatedDiscounts = activeDiscounts.filter((discount: any) => discount.id !== discountId);
          
          // Update the activeDiscounts field
          await (prisma as any).product.update({
            where: { id: productId },
            data: {
              activeDiscounts: JSON.stringify(updatedDiscounts),
              lastMetafieldUpdate: new Date()
            }
          });
        } catch (parseError) {
          this.logger.warn("Failed to parse activeDiscounts when removing discount", { 
            productId, 
            discountId, 
            error: parseError instanceof Error ? parseError.message : String(parseError) 
          });
        }
      } else {
        // Update timestamp even if no activeDiscounts
        await (prisma as any).product.update({
          where: { id: productId },
          data: {
            lastMetafieldUpdate: new Date()
          }
        });
      }

      this.logger.info("Product removed from discount", { productId, discountId });
      return true;

    } catch (error) {
      this.logger.error(error as Error, { scope: "removeProductFromDiscount", productId, discountId });
      return false;
    }
  }

  /**
   * Get all products with pagination
   */
  async getAllProducts(page: number = 1, limit: number = 50) {
    try {
      const skip = (page - 1) * limit;
      
      const [products, total] = await Promise.all([
        (prisma as any).product.findMany({
          skip,
          take: limit,
          include: {
            discounts: {
              include: {
                discount: true
              }
            }
          },
          orderBy: {
            updatedAt: 'desc'
          }
        }),
        (prisma as any).product.count()
      ]);

      return {
        products: products.map((product: any) => ({
          ...product,
          activeDiscounts: product.activeDiscounts ? JSON.parse(product.activeDiscounts) : [],
          discounts: product.discounts.filter((pd: any) => pd.discount.isActive)
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      this.logger.error(error as Error, { scope: "getAllProducts" });
      return {
        products: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0
        }
      };
    }
  }

  /**
   * Get active discounts for a product
   */
  async getProductActiveDiscounts(productId: string): Promise<any[]> {
    try {
      const product = await (prisma as any).product.findUnique({
        where: { id: productId },
        select: { activeDiscounts: true }
      });

      if (!product || !product.activeDiscounts) {
        return [];
      }

      return JSON.parse(product.activeDiscounts);
    } catch (error) {
      this.logger.error(error as Error, { scope: "getProductActiveDiscounts", productId });
      return [];
    }
  }

  /**
   * Sync active discounts from Shopify metafield to local database
   */
  async syncActiveDiscountsFromShopify(productId: string): Promise<boolean> {
    try {
      // Get the current active_discounts metafield from Shopify
      const response = await this.adminClient.graphql(`
        query getProductActiveDiscounts($productId: ID!) {
          product(id: $productId) {
            metafield(namespace: "discount_manager", key: "active_discounts") {
              value
            }
          }
        }
      `, { productId });

      const metafield = response.data?.product?.metafield;
      const activeDiscounts = metafield?.value || null;

      // Update the local database
      await (prisma as any).product.update({
        where: { id: productId },
        data: {
          activeDiscounts: activeDiscounts,
          lastMetafieldUpdate: new Date()
        }
      });

      this.logger.info("Synced active discounts from Shopify", { productId });
      return true;
    } catch (error) {
      this.logger.error(error as Error, { scope: "syncActiveDiscountsFromShopify", productId });
      return false;
    }
  }

  /**
   * Update product active discounts
   */
  async updateProductActiveDiscounts(productId: string, activeDiscounts: string): Promise<boolean> {
    try {
      await (prisma as any).product.update({
        where: { id: productId },
        data: {
          activeDiscounts: activeDiscounts,
          lastMetafieldUpdate: new Date()
        }
      });

      this.logger.info("Product active discounts updated", { productId });
      return true;

    } catch (error) {
      this.logger.error(error as Error, { scope: "updateProductActiveDiscounts", productId });
      return false;
    }
  }
}
