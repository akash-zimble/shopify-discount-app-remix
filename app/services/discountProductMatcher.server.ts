import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Logger } from "../utils/logger.server";

export interface ProductMetafieldData {
  id: string;
  title: string;
  value: string;
  type: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  summary?: string;
  customerEligibility?: "all" | "segment" | "specific";
  posExcluded?: boolean;
  canCombine?: boolean;
  minimumRequirement?: { type: "amount" | "quantity" | "none"; value?: number; currencyCode?: string };
  appliesTo?: "one_time" | "subscriptions" | "both";
  details?: string[];
}

export class DiscountProductMatcher {
  private admin: AdminApiContext;
  private logger: Logger;

  constructor(admin: AdminApiContext, logger: Logger) {
    this.admin = admin;
    this.logger = logger;
  }

  // Main method to get all products affected by a discount
  async getAffectedProducts(discountId: string): Promise<string[]> {
    try {
      const nodeId = this.toDiscountNodeId(discountId);
      // First, get the discount details to understand what it targets
      const discountDetails = await this.getDiscountDetails(nodeId);

      if (!discountDetails) {
        this.logger.warn("Discount not found", { discountId });
        return [];
      }

      this.logger.info("Processing discount", { title: discountDetails.title, discountId });

      // Check what the discount targets
      if (discountDetails.appliesToAllProducts) {
        return await this.getAllProductIds();
      }

      if (discountDetails.productIds && discountDetails.productIds.length > 0) {
        return discountDetails.productIds;
      }

      if (discountDetails.collectionIds && discountDetails.collectionIds.length > 0) {
        return await this.getProductsFromCollections(discountDetails.collectionIds);
      }

      this.logger.info("No targeting found for discount", { discountId });
      return [];

    } catch (error) {
      this.logger.error(error as Error, { scope: "getAffectedProducts", discountId });
      return [];
    }
  }

  private toDiscountNodeId(inputId: string): string {
    if (!inputId) return inputId;
    if (inputId.startsWith('gid://')) return inputId;
    const parts = inputId.split('/');
    const tail = parts[parts.length - 1];
    // Prefer Automatic and Code nodes as they are actual concrete types
    return `gid://shopify/DiscountAutomaticNode/${tail}`;
  }

  // Get discount details and targeting information
  // Get discount details and targeting information
  private async getDiscountDetails(discountId: string) {
    const id = this.toDiscountNodeId(discountId);
    const response = await this.admin.graphql(`
      #graphql
      query getDiscountDetails($id: ID!) {
        discountNode(id: $id) {
          id
          discount {
            ... on DiscountCodeBasic {
              title
              status
              summary
              customerGets {
                value {
                  ... on DiscountAmount {
                    __typename
                    amount {
                      amount
                      currencyCode
                    }
                  }
                  ... on DiscountPercentage {
                    __typename
                    percentage
                  }
                }
                items {
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
              summary
              customerGets {
                value {
                  ... on DiscountAmount {
                    __typename
                    amount {
                      amount
                      currencyCode
                    }
                  }
                  ... on DiscountPercentage {
                    __typename
                    percentage
                  }
                }
                items {
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
              summary
              customerGets {
                value {
                  ... on DiscountAmount {
                    __typename
                    amount {
                      amount
                      currencyCode
                    }
                  }
                  ... on DiscountPercentage {
                    __typename
                    percentage
                  }
                }
                items {
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
    `, {
      variables: { id }
    });

    const data = await response.json();

    // 🔍 DEBUG: Log the complete response
    this.logger.debug("RAW DISCOUNT DATA", { data });

    const discountNode = data.data?.discountNode;

    if (!discountNode) {
      this.logger.warn("No discount node found", { discountId });
      return null;
    }

    const discount = discountNode.discount;
    this.logger.debug("DISCOUNT TYPE", { type: discount.__typename });
    this.logger.debug("CUSTOMER GETS", { customerGets: discount.customerGets });
    
    const customerGets = discount.customerGets;
    const value = customerGets?.value;
    
    this.logger.debug("VALUE DATA", { value });
    
    // Parse the items and value
    const items = customerGets?.items;
    let appliesToAll = false;
    let productIds: string[] = [];
    let collectionIds: string[] = [];

    if (items) {
      // Check each key in the items object
      if (items.allItems === true) {
        appliesToAll = true;
      }
      if (items.products?.edges) {
        productIds = items.products.edges.map((edge: any) => edge.node.id);
      }
      if (items.collections?.edges) {
        collectionIds = items.collections.edges.map((edge: any) => edge.node.id);
      }
    }

    this.logger.info("Parsed discount targeting", { appliesToAll, productCount: productIds.length, collectionCount: collectionIds.length });

    return {
      id: discountNode.id,
      title: discount.title,
      status: discount.status,
      appliesToAllProducts: appliesToAll,
      productIds: productIds,
      collectionIds: collectionIds,
      value: value, 
      customerGets: customerGets
    }
  }


  // Get all product IDs in the store
  public async getAllProductIds(): Promise<string[]> {
    const response = await this.admin.graphql(`
      #graphql
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

    const data = await response.json();
    const ids = data.data?.products?.edges?.map((edge: any) => edge.node.id) || [];
    this.logger.debug("Fetched all product ids", { count: ids.length });
    return ids;
  }

  // Get all products in specified collections
  public async getProductsFromCollections(collectionIds: string[]): Promise<string[]> {
    let allProductIds: string[] = [];

    for (const collectionId of collectionIds) {
      const response = await this.admin.graphql(`
        #graphql
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
      `, {
        variables: { id: collectionId }
      });

      const data = await response.json();
      const productIds = data.data?.collection?.products?.edges?.map((edge: any) => edge.node.id) || [];
      allProductIds.push(...productIds);
    }

    // Remove duplicates
    return [...new Set(allProductIds)];
  }

  // Update product metafield with discount information
  async updateProductMetafield(productId: string, discountData: ProductMetafieldData) {
    try {
      if (!discountData.id) {
        this.logger.error("Attempting to update metafield with empty discount id", { productId, discountData });
      }
      // First, get existing metafield value
      const existingMetafield = await this.getProductMetafield(productId);
      let discountArray: ProductMetafieldData[] = [];

      if (existingMetafield) {
        try {
          discountArray = JSON.parse(existingMetafield) || [];
        } catch {
          discountArray = [];
        }
      }

      // Remove any existing entry for this discount (in case it's an update)
      discountArray = discountArray.filter(d => d.id !== discountData.id);

      // Add the new/updated discount data
      discountArray.push(discountData);

      // Update the metafield
      // ✅ FIXED MUTATION (no unused variables):
      const response = await this.admin.graphql(`
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
            namespace: "discount_manager",
            key: "active_discounts",
            value: JSON.stringify(discountArray),
            type: "json"
          }]
        }
      });


      const result = await response.json();

      if (result.data?.metafieldsSet?.userErrors?.length > 0) {
        this.logger.error("Metafield update errors", { userErrors: result.data.metafieldsSet.userErrors, productId });
        return false;
      }

      this.logger.info("Updated product metafield", { productId, discountId: discountData.id });
      return true;

    } catch (error) {
      this.logger.error(error as Error, { scope: "updateProductMetafield", productId, discountId: discountData.id });
      return false;
    }
  }

  // Remove discount from product metafield
  async removeDiscountFromProduct(productId: string, discountId: string) {
    try {
      const existingMetafield = await this.getProductMetafield(productId);

      if (!existingMetafield) {
        return true; // Nothing to remove
      }

      let discountArray: ProductMetafieldData[] = [];
      try {
        discountArray = JSON.parse(existingMetafield) || [];
      } catch {
        return true; // Invalid JSON, consider it empty
      }

      // Remove the discount from the array
      const filteredArray = discountArray.filter(d => d.id !== discountId);

      if (filteredArray.length === discountArray.length) {
        return true; // Discount wasn't in the array anyway
      }

      // Update the metafield with the filtered array
      const response = await this.admin.graphql(`
        #graphql
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
            namespace: "discount_manager",
            key: "active_discounts",
            value: JSON.stringify(filteredArray),
            type: "json"
          }]
        }
      });

      const result = await response.json();

      if (result.data?.metafieldsSet?.userErrors?.length > 0) {
        this.logger.error("Metafield removal errors", { userErrors: result.data.metafieldsSet.userErrors, productId, discountId });
        return false;
      }

      this.logger.info("Removed discount from product metafield", { productId, discountId });
      return true;

    } catch (error) {
      this.logger.error(error as Error, { scope: "removeDiscountFromProduct", productId, discountId });
      return false;
    }
  }

  // Get existing product metafield value
  private async getProductMetafield(productId: string): Promise<string | null> {
    const response = await this.admin.graphql(`
      #graphql
      query getProductMetafield($productId: ID!) {
        product(id: $productId) {
          metafield(namespace: "discount_manager", key: "active_discounts") {
            value
          }
        }
      }
    `, {
      variables: { productId }
    });

    const data = await response.json();
    const value = data.data?.product?.metafield?.value || null;
    this.logger.debug("Fetched product metafield", { productId, hasValue: Boolean(value) });
    return value;
  }
}
