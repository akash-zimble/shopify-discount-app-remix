import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server";
import { DiscountProductMatcher } from "../services/discountProductMatcher.server";
import { Session } from "@shopify/shopify-api";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify this is a legitimate cron request (you can add additional security here)
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET_TOKEN;
  
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const logger = createLogger({ name: "cron.discount-cleanup" });
  logger.info("Starting discount cleanup cron job");

  try {
    // Get all active discounts from database
    const activeDiscounts = await prisma.discountMetafieldRule.findMany({
      where: { 
        isActive: true,
        endDate: { not: null } // Only check discounts that have an end date
      }
    });

    logger.info(`Found ${activeDiscounts.length} active discounts to check`);

    const currentTime = new Date();
    const expiredDiscounts = [];
    let deactivatedCount = 0;

    for (const discount of activeDiscounts) {
      try {
        // Parse the stored discount data
        let discountData;
        try {
          discountData = JSON.parse(discount.metafieldValue);
        } catch (error) {
          logger.warn(`Failed to parse discount data for ${discount.discountId}`, { error });
          continue;
        }

        // Check if discount has expired
        const endDate = discount.endDate || (discountData.endsAt ? new Date(discountData.endsAt) : null);
        
        if (endDate && endDate <= currentTime) {
          logger.info(`Discount ${discount.discountId} has expired`, { 
            endDate: endDate.toISOString(),
            currentTime: currentTime.toISOString()
          });

          // Deactivate the discount in database
          await prisma.discountMetafieldRule.update({
            where: { id: discount.id },
            data: {
              isActive: false,
              status: "EXPIRED",
              lastRan: new Date(),
              productsCount: 0
            }
          });

          // Remove from product metafields if we have discount data
          if (discountData.id) {
            try {
              // Get the most recent session to authenticate with Shopify
              const session = await prisma.session.findFirst({
                orderBy: { expires: 'desc' }
              });

              if (!session) {
                logger.warn(`No session found, skipping product cleanup for discount ${discountData.id}`);
                continue;
              }

              // Create a proper Shopify session object
              const shopifySession = new Session({
                id: session.id,
                shop: session.shop,
                state: session.state,
                isOnline: session.isOnline,
                accessToken: session.accessToken,
                scope: session.scope || '',
              });

              // Create admin client that matches the expected interface
              const adminClient = {
                graphql: async (query: string, options: any = {}) => {
                  // Use the stored access token to make GraphQL requests
                  const response = await fetch(`https://${session.shop}/admin/api/2025-01/graphql.json`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Shopify-Access-Token': session.accessToken,
                    },
                    body: JSON.stringify({ query, variables: options.variables || {} })
                  });
                  
                  if (!response.ok) {
                    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
                  }
                  
                  // Return a response-like object with a json() method
                  return {
                    json: async () => response.json()
                  };
                },
                session: shopifySession
              };

              const matcher = new DiscountProductMatcher(adminClient as any, logger);

              // Get all products and remove this discount
              const allProducts = await matcher.getAllProductIds();
              let removalCount = 0;
              const maxProducts = Math.min(allProducts.length, 50); // Process more products for cron job

              for (let i = 0; i < maxProducts; i++) {
                try {
                  const success = await matcher.removeDiscountFromProduct(allProducts[i], discountData.id);
                  if (success) removalCount++;
                  await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
                } catch (error) {
                  logger.error(`Error removing expired discount from product ${allProducts[i]}`, { 
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              }

              logger.info(`Removed expired discount ${discountData.id} from ${removalCount} products`);
            } catch (error) {
              logger.error(`Error cleaning up expired discount ${discountData.id}`, { 
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              });
            }
          }

          expiredDiscounts.push({
            id: discount.discountId,
            title: discount.discountTitle,
            endDate: endDate.toISOString()
          });

          deactivatedCount++;
        }
      } catch (error) {
        logger.error(`Error processing discount ${discount.discountId}`, { error });
      }
    }

    logger.info(`Cron job completed`, { 
      totalChecked: activeDiscounts.length,
      expiredFound: expiredDiscounts.length,
      deactivatedCount
    });

    return json({
      success: true,
      message: `Processed ${activeDiscounts.length} discounts`,
      expired: expiredDiscounts,
      deactivatedCount
    });

  } catch (error) {
    logger.error("Cron job failed", { error });
    return json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  }
};

