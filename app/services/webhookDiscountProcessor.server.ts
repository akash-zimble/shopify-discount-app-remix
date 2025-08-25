import prisma from "../db.server";
import { DiscountProductMatcher } from "./discountProductMatcher.server";
import { DiscountDataExtractor } from "./discountDataExtractor.server";

export class WebhookDiscountProcessor {
  private adminClient: any;
  
  constructor(adminClient: any) {
    this.adminClient = adminClient;
  }

  async processDiscountCreate(payload: any) {
    const discountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
    
    if (!discountId) {
      throw new Error("No discount ID found in payload");
    }

    // Fetch full discount details
    const fullDiscountDetails = await this.fetchFullDiscountDetails(payload.admin_graphql_api_id);
    
    // Extract structured data
    const extractedData = fullDiscountDetails 
      ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails)
      : DiscountDataExtractor.extractFromWebhookPayload(payload);

    // Store in database
    await prisma.discountMetafieldRule.create({
      data: {
        discountId: String(discountId),
        discountType: extractedData.discountType,
        discountTitle: extractedData.title,
        metafieldNamespace: "discount_manager",
        metafieldKey: "active_discounts",
        metafieldValue: JSON.stringify(extractedData),
        isActive: true
      }
    });

    console.log(`✅ Created metafield rule for ${extractedData.discountType} discount: ${extractedData.title}`);

    // Update product metafields
    await this.updateAffectedProductMetafields(payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`, extractedData);

    return extractedData;
  }

  async processDiscountUpdate(payload: any) {
    const discountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
    
    if (!discountId) {
      throw new Error("No discount ID found in payload");
    }

    // Fetch full discount details
    const fullDiscountDetails = await this.fetchFullDiscountDetails(payload.admin_graphql_api_id);
    
    // Extract structured data
    const extractedData = fullDiscountDetails 
      ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails)
      : DiscountDataExtractor.extractFromWebhookPayload(payload);

    // Update database
    const updated = await prisma.discountMetafieldRule.updateMany({
      where: { discountId: String(discountId) },
      data: {
        discountTitle: extractedData.title,
        metafieldValue: JSON.stringify(extractedData),
        isActive: true
      }
    });

    if (updated.count === 0) {
      // Create if doesn't exist
      await prisma.discountMetafieldRule.create({
        data: {
          discountId: String(discountId),
          discountType: extractedData.discountType,
          discountTitle: extractedData.title,
          metafieldNamespace: "discount_manager",
          metafieldKey: "active_discounts",
          metafieldValue: JSON.stringify(extractedData),
          isActive: true
        }
      });
    }

    console.log(`✅ Updated metafield rule for ${extractedData.discountType} discount: ${extractedData.title}`);

    // Update product metafields
    await this.updateAffectedProductMetafields(payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`, extractedData);

    return extractedData;
  }

  async processDiscountDelete(payload: any) {
    const discountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
    
    if (!discountId) {
      throw new Error("No discount ID found in payload");
    }

    // Get existing rule before deactivating
    const existingRule = await prisma.discountMetafieldRule.findFirst({
      where: { discountId: String(discountId), isActive: true }
    });

    // Deactivate rule
    await prisma.discountMetafieldRule.updateMany({
      where: { discountId: String(discountId) },
      data: { isActive: false }
    });

    console.log(`✅ Deactivated metafield rule for deleted discount: ${discountId}`);

    // Remove from product metafields
    if (existingRule) {
      await this.removeFromProductMetafields(existingRule, discountId);
    }

    return { id: discountId, deleted: true };
  }

  private async fetchFullDiscountDetails(discountGraphqlId: string) {
    try {
      const response = await this.adminClient.graphql(`
        #graphql
        query getFullDiscountDetails($id: ID!) {
          discountNode(id: $id) {
            id
            discount {
              ... on DiscountCodeBasic {
                id
                title
                status
                startsAt
                endsAt
                usageLimit
                codes(first: 1) {
                  edges {
                    node {
                      code
                    }
                  }
                }
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
                id
                title
                status
                startsAt
                endsAt
                usageLimit
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
        variables: { id: discountGraphqlId }
      });

      const data = await response.json();
      return data.data?.discountNode?.discount || null;
    } catch (error) {
      console.error("Error fetching full discount details:", error);
      return null;
    }
  }

  private async updateAffectedProductMetafields(discountGraphqlId: string, extractedData: any) {
    try {
      const matcher = new DiscountProductMatcher(this.adminClient);
      const affectedProducts = await matcher.getAffectedProducts(discountGraphqlId);
      
      console.log(`📦 Found ${affectedProducts.length} products affected by discount`);

      let updateCount = 0;
      const maxProducts = Math.min(affectedProducts.length, 10);
      
      for (let i = 0; i < maxProducts; i++) {
        try {
          const success = await matcher.updateProductMetafield(affectedProducts[i], extractedData);
          if (success) updateCount++;
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error updating product ${affectedProducts[i]}:`, error);
        }
      }

      console.log(`✅ Updated metafields on ${updateCount}/${maxProducts} products`);
    } catch (error) {
      console.error("Error updating product metafields:", error);
    }
  }

  private async removeFromProductMetafields(existingRule: any, discountId: string) {
    try {
      // Parse stored discount details to get targeting info
      let storedDiscountDetails;
      try {
        storedDiscountDetails = JSON.parse(existingRule.metafieldValue);
      } catch (error) {
        console.log("Could not parse stored discount details");
        return;
      }

      const matcher = new DiscountProductMatcher(this.adminClient);
      
      // For simplicity, remove from all products that might have this discount
      // In a production app, you'd want to be more selective
      const allProducts = await matcher.getAllProductIds();
      
      let removalCount = 0;
      const maxProducts = Math.min(allProducts.length, 20);
      
      for (let i = 0; i < maxProducts; i++) {
        try {
          const success = await matcher.removeDiscountFromProduct(allProducts[i], String(discountId));
          if (success) removalCount++;
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error removing discount from product ${allProducts[i]}:`, error);
        }
      }

      console.log(`✅ Removed discount from ${removalCount}/${maxProducts} products`);
    } catch (error) {
      console.error("Error removing discount from products:", error);
    }
  }
}
