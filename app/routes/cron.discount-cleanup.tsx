import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DiscountProductMatcher } from "../services/discountProductMatcher.server";
import { createLogger } from "../utils/logger.server";

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
              // Get admin client for product cleanup
              const { admin } = await authenticate.admin(request);
              const adminClient = createAdminWrapper(admin);
              const matcher = new DiscountProductMatcher(adminClient, logger);

              // Get all products and remove this discount
              const allProducts = await matcher.getAllProductIds();
              let removalCount = 0;
              const maxProducts = Math.min(allProducts.length, 50); // Process more products for cron job

              for (let i = 0; i < maxProducts; i++) {
                try {
                  const success = await matcher.removeDiscountFromProduct(allProducts[i], discountData.id);
                  if (success) removalCount++;
                  await new Promise(resolve => setTimeout(resolve, 200)); // Faster rate limiting for cron
                } catch (error) {
                  logger.error(`Error removing expired discount from product ${allProducts[i]}`, { error });
                }
              }

              logger.info(`Removed expired discount ${discountData.id} from ${removalCount} products`);
            } catch (error) {
              logger.error(`Error cleaning up expired discount ${discountData.id}`, { error });
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

function createAdminWrapper(admin: any) {
  return {
    graphql: async (query: string, options: any = {}) => {
      return await admin.graphql(query, options);
    }
  } as any;
}
