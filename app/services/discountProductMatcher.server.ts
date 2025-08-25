import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface ProductMetafieldData {
  id: string;
  title: string;
  value: string;
  type: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
}

export class DiscountProductMatcher {
  private admin: AdminApiContext;

  constructor(admin: AdminApiContext) {
    this.admin = admin;
  }

  // Main method to get all products affected by a discount
  async getAffectedProducts(discountId: string): Promise<string[]> {
    try {
      // First, get the discount details to understand what it targets
      const discountDetails = await this.getDiscountDetails(discountId);

      if (!discountDetails) {
        console.log(`Discount ${discountId} not found`);
        return [];
      }

      console.log(`Processing discount: ${discountDetails.title}`);

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

      console.log(`No targeting found for discount ${discountId}`);
      return [];

    } catch (error) {
      console.error("Error finding affected products:", error);
      return [];
    }
  }

  // Get discount details and targeting information
  // Get discount details and targeting information
  private async getDiscountDetails(discountId: string) {
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
      variables: { id: discountId }
    });

    const data = await response.json();

    // 🔍 DEBUG: Log the complete response
    console.log("🔍 RAW DISCOUNT DATA:", JSON.stringify(data, null, 2));

    const discountNode = data.data?.discountNode;

    if (!discountNode) {
      console.log("❌ No discount node found");
      return null;
    }

    const discount = discountNode.discount;
    console.log("🔍 DISCOUNT TYPE:", discount.__typename);
    console.log("🔍 CUSTOMER GETS:", JSON.stringify(discount.customerGets, null, 2));

    // ✅ NEW CODE (handles object structure):
    const items = discount.customerGets?.items;
    console.log("🔍 ITEMS STRUCTURE:", JSON.stringify(items, null, 2));

    // Parse the items object directly (not as array)
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

    console.log(`🎯 PARSED RESULTS: appliesToAll=${appliesToAll}, products=${productIds.length}, collections=${collectionIds.length}`);

    return {
      id: discountNode.id,
      title: discount.title,
      status: discount.status,
      appliesToAllProducts: appliesToAll,
      productIds: productIds,
      collectionIds: collectionIds
    };

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
    return data.data?.products?.edges?.map((edge: any) => edge.node.id) || [];
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
        console.error("Metafield update errors:", result.data.metafieldsSet.userErrors);
        return false;
      }

      console.log(`✅ Updated metafield for product ${productId} with discount ${discountData.id}`);
      return true;

    } catch (error) {
      console.error(`Error updating metafield for product ${productId}:`, error);
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
        mutation updateProductMetafield($productId: ID!, $metafields: [MetafieldsSetInput!]!) {
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
        console.error("Metafield removal errors:", result.data.metafieldsSet.userErrors);
        return false;
      }

      console.log(`✅ Removed discount ${discountId} from product ${productId} metafield`);
      return true;

    } catch (error) {
      console.error(`Error removing discount from product ${productId}:`, error);
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
    return data.data?.product?.metafield?.value || null;
  }
}
