import { IDiscountTargetingService, DiscountTargeting } from './interfaces/IDiscountService';
import { IAdminClient } from './interfaces/IAdminClient';
import { Logger } from '../utils/logger.server';
import { validationService } from './validation.service';

/**
 * Discount targeting service implementation
 * Handles determining which products are affected by discounts
 */
export class DiscountTargetingService implements IDiscountTargetingService {
  constructor(
    private adminClient: IAdminClient,
    private logger: Logger
  ) {}

  async getAffectedProducts(discountId: string): Promise<string[]> {
    try {
      // Validate input
      const validation = validationService.validateDiscountId(discountId);
      if (!validation.isValid) {
        this.logger.error('Invalid discount ID', { discountId, errors: validation.errors });
        return [];
      }

      const targeting = await this.getDiscountTargeting(discountId);
      
      if (targeting.appliesToAllProducts) {
        return await this.getAllProductIds();
      }

      if (targeting.productIds.length > 0) {
        return targeting.productIds;
      }

      if (targeting.collectionIds.length > 0) {
        return await this.getProductsFromCollections(targeting.collectionIds);
      }

      this.logger.info('No targeting found for discount', { discountId });
      return [];
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountTargetingService.getAffectedProducts', discountId });
      return [];
    }
  }

  async getDiscountTargeting(discountId: string): Promise<DiscountTargeting> {
    try {
      // Extract the numeric ID from the input
      const numericId = this.extractNumericId(discountId);
      
      // Try different discount node types
      const candidates = [
        `gid://shopify/DiscountAutomaticNode/${numericId}`,
        `gid://shopify/DiscountCodeNode/${numericId}`,
        `gid://shopify/DiscountNode/${numericId}`
      ];

      for (const nodeId of candidates) {
        try {
          // Use the correct DiscountNode query structure with targeting information
          const response = await this.adminClient.executeQuery(`
            query getDiscountTargeting($id: ID!) {
              discountNode(id: $id) {
                id
                discount {
                  __typename
                  ... on DiscountCodeBasic {
                    title
                    status
                    customerGets {
                      items {
                        __typename
                        ... on DiscountProducts { 
                          products(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on DiscountCollections { 
                          collections(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on AllDiscountItems { 
                          allItems 
                        }
                      }
                    }
                  }
                  ... on DiscountAutomaticBasic {
                    title
                    status
                    customerGets {
                      items {
                        __typename
                        ... on DiscountProducts { 
                          products(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on DiscountCollections { 
                          collections(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on AllDiscountItems { 
                          allItems 
                        }
                      }
                    }
                  }
                  ... on DiscountAutomaticBxgy {
                    title
                    status
                    customerGets {
                      items {
                        __typename
                        ... on DiscountProducts { 
                          products(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on DiscountCollections { 
                          collections(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on AllDiscountItems { 
                          allItems 
                        }
                      }
                    }
                    customerBuys {
                      items {
                        __typename
                        ... on DiscountProducts { 
                          products(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on DiscountCollections { 
                          collections(first: 250) { 
                            edges { 
                              node { 
                                id 
                              } 
                            } 
                          } 
                        }
                        ... on AllDiscountItems { 
                          allItems 
                        }
                      }
                    }
                  }
                }
              }
            }
          `, { variables: { id: nodeId } });

          const discountNode = response.data?.discountNode;
          const discount = discountNode?.discount;
          if (discount && (discount.__typename === 'DiscountCodeBasic' || discount.__typename === 'DiscountAutomaticBasic' || discount.__typename === 'DiscountAutomaticBxgy')) {
            this.logger.info('Found discount node', {
              discountId,
              typename: discount.__typename,
              title: discount.title,
              status: discount.status,
            });

            // Parse the actual targeting data
            const customerGets = discount.customerGets;
            const customerBuys = discount.__typename === 'DiscountAutomaticBxgy' ? discount.customerBuys : undefined;

            let appliesToAll = false;
            let productIds: string[] = [];
            let collectionIds: string[] = [];

            const accumulate = (items: any) => {
              if (!items) return;
              if (items.allItems === true) appliesToAll = true;
              if (items.products?.edges) {
                productIds.push(...items.products.edges.map((e: any) => e.node.id));
              }
              if (items.collections?.edges) {
                collectionIds.push(...items.collections.edges.map((e: any) => e.node.id));
              }
            };

            accumulate(customerGets?.items);
            accumulate(customerBuys?.items);

            // Remove duplicates
            productIds = Array.from(new Set(productIds));
            collectionIds = Array.from(new Set(collectionIds));

            this.logger.info('Parsed discount targeting', {
              discountId,
              appliesToAll,
              productCount: productIds.length,
              collectionCount: collectionIds.length,
            });

            return {
              appliesToAllProducts: appliesToAll,
              productIds,
              collectionIds,
            };
          }
        } catch (error) {
          this.logger.debug('Failed to query discount with node type', { nodeId, error: error instanceof Error ? error.message : String(error) });
          continue;
        }
      }

      this.logger.warn('Discount not found with any node type', { discountId, candidates });
      // Return a special indicator that this discount couldn't be found
      return { appliesToAllProducts: false, productIds: [], collectionIds: [], notFound: true };
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountTargetingService.getDiscountTargeting', discountId });
      return { appliesToAllProducts: false, productIds: [], collectionIds: [], notFound: true };
    }
  }

  async getAllProductIds(): Promise<string[]> {
    try {
      const response = await this.adminClient.executeQuery(`
        query getAllProducts {
          products(first: 250) {
            edges {
              node {
                id
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `);

      const products = response.data?.products?.edges?.map((edge: any) => edge.node.id) || [];
      this.logger.debug('Fetched all product IDs', { count: products.length });
      return products;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountTargetingService.getAllProductIds' });
      return [];
    }
  }

  async getProductsFromCollections(collectionIds: string[]): Promise<string[]> {
    try {
      // Validate input
      if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
        return [];
      }

      let allProductIds: string[] = [];

      for (const collectionId of collectionIds) {
        try {
          const response = await this.adminClient.executeQuery(`
            query getCollectionProducts($id: ID!) {
              collection(id: $id) {
                products(first: 250) {
                  edges {
                    node {
                      id
                    }
                  }
                }
              }
            }
          `, { variables: { id: collectionId } });

          const productIds = response.data?.collection?.products?.edges?.map((edge: any) => edge.node.id) || [];
          allProductIds.push(...productIds);
        } catch (error) {
          this.logger.error(error as Error, {
            scope: 'DiscountTargetingService.getProductsFromCollections.collection',
            collectionId,
          });
        }
      }

      // Remove duplicates
      const uniqueProductIds = Array.from(new Set(allProductIds));
      this.logger.info('Fetched products from collections', {
        collectionCount: collectionIds.length,
        productCount: uniqueProductIds.length,
      });

      return uniqueProductIds;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountTargetingService.getProductsFromCollections', collectionIds });
      return [];
    }
  }

  private extractNumericId(inputId: string): string {
    if (!inputId) return inputId;
    
    // If it's already a numeric ID, return it
    if (/^\d+$/.test(inputId)) {
      return inputId;
    }
    
    // If it's a GID, extract the numeric part
    if (inputId.startsWith('gid://')) {
      const parts = inputId.split('/');
      return parts[parts.length - 1];
    }
    
    // If it's some other format, try to extract the last numeric part
    const parts = inputId.split('/');
    const tail = parts[parts.length - 1];
    return tail;
  }

  private toDiscountNodeId(inputId: string): string {
    if (!inputId) return inputId;
    if (inputId.startsWith('gid://')) return inputId;
    
    const numericId = this.extractNumericId(inputId);
    // Prefer Automatic and Code nodes as they are actual concrete types
    return `gid://shopify/DiscountAutomaticNode/${numericId}`;
  }
}
