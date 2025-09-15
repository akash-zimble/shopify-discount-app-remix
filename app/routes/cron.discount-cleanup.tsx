import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createServiceLogger, createDiscountServiceStack } from "../services/service-factory";
import { ErrorHandlingService, UnauthorizedError } from "../services/error-handling.service";
import { configurationService } from "../services/configuration.service";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Optimized cron job handler for discount cleanup
 * Follows SOLID principles with proper error handling and validation
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const logger = createServiceLogger("cron.discount-cleanup");
  const errorHandler = new ErrorHandlingService(logger);

  try {
    // Verify authorization
    const authHeader = request.headers.get("Authorization");
    const expectedToken = configurationService.get("app.cronSecretToken");
    
    if (!expectedToken) {
      logger.error("CRON_SECRET_TOKEN not configured");
      throw new UnauthorizedError("Cron secret token not configured");
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7);
    if (token !== expectedToken) {
      throw new UnauthorizedError("Invalid cron secret token");
    }

    logger.info("Starting discount cleanup cron job");

    // Find expired discounts grouped by shop
    const expiredDiscounts = await errorHandler.withErrorHandling(
      () => prisma.discountMetafieldRule.findMany({
        where: {
          isActive: true,
          endDate: {
            lt: new Date(),
          },
        },
        orderBy: { endDate: 'asc' },
      }),
      { scope: "cron.findExpiredDiscounts" }
    );

    logger.info(`Found ${expiredDiscounts.length} expired discounts`);

    if (expiredDiscounts.length === 0) {
      return json(errorHandler.createSuccessResponse({
        processed: 0,
        expired: [],
        deactivatedCount: 0,
        shopsProcessed: 0,
      }, "No expired discounts found"));
    }

    // Group discounts by shop for proper session mapping
    const discountsByShop = expiredDiscounts.reduce((acc, discount) => {
      if (!acc[discount.shop]) {
        acc[discount.shop] = [];
      }
      acc[discount.shop].push(discount);
      return acc;
    }, {} as Record<string, typeof expiredDiscounts>);

    logger.info(`Processing expired discounts across ${Object.keys(discountsByShop).length} shops`);

    let totalDeactivatedCount = 0;
    let totalMetafieldCleanupCount = 0;
    const allExpiredDiscountData = [];
    const shopResults = [];

    // Process each shop independently
    for (const [shop, shopDiscounts] of Object.entries(discountsByShop)) {
      logger.info(`Processing ${shopDiscounts.length} expired discounts for shop: ${shop}`);
      
      // Get session for this specific shop
      const session = await errorHandler.withErrorHandling(
        () => prisma.session.findFirst({
          where: { shop },
          orderBy: { expires: 'desc' }
        }),
        { scope: "cron.getShopSession", shop }
      );

      if (!session) {
        logger.error(`No valid session found for shop: ${shop}`);
        // Still deactivate discounts in database even without session
        for (const discount of shopDiscounts) {
          await errorHandler.withErrorHandling(
            () => prisma.discountMetafieldRule.updateMany({
              where: { discountId: discount.discountId, shop: discount.shop },
              data: {
                isActive: false,
                status: "EXPIRED",
                lastRan: new Date(),
                updatedAt: new Date(),
              },
            }),
            { scope: "cron.deactivateDiscountNoSession", discountId: discount.discountId, shop }
          );
          totalDeactivatedCount++;
          allExpiredDiscountData.push({
            id: discount.discountId,
            title: discount.discountTitle,
            endDate: discount.endDate,
            shop: discount.shop,
          });
        }
        continue;
      }

      // Create admin client for this specific shop
      const adminClient = {
        graphql: async (query: string, options: { variables?: Record<string, any> } = {}) => {
          const url = `https://${session.shop}/admin/api/2025-07/graphql.json`;
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': session.accessToken,
            },
            body: JSON.stringify({
              query,
              variables: options.variables || {},
            }),
          });

          return response;
        }
      };

      // Create service stack for this shop's operations
      const { discountService, targetingService, metafieldService } = createDiscountServiceStack(adminClient, `cron-cleanup-${shop}`, shop);

      let shopDeactivatedCount = 0;
      let shopMetafieldCleanupCount = 0;
      const shopExpiredDiscountData = [];

      // Process each expired discount for this shop
      for (const discount of shopDiscounts) {
        try {
          // Deactivate the discount
          await errorHandler.withErrorHandling(
            () => prisma.discountMetafieldRule.updateMany({
              where: { discountId: discount.discountId, shop: discount.shop },
              data: {
                isActive: false,
                status: "EXPIRED",
                lastRan: new Date(),
                updatedAt: new Date(),
              },
            }),
            { scope: "cron.deactivateDiscount", discountId: discount.discountId, shop }
          );

          shopDeactivatedCount++;
          totalDeactivatedCount++;
          shopExpiredDiscountData.push({
            id: discount.discountId,
            title: discount.discountTitle,
            endDate: discount.endDate,
            shop: discount.shop,
          });
          allExpiredDiscountData.push(shopExpiredDiscountData[shopExpiredDiscountData.length - 1]);

          logger.info(`Deactivated expired discount: ${discount.discountTitle} (${discount.discountId}) for shop: ${shop}`);

          // Remove discount from product metafields and ProductDiscount relationships
          try {
            logger.info(`Cleaning up expired discount ${discount.discountId} from product metafields and relationships for shop: ${shop}...`);
            
            // Use the discount service method that properly handles both metafields and ProductDiscount relationships
            await errorHandler.withErrorHandling(
              () => discountService.removeFromProductMetafields(discount as any, discount.discountId),
              { scope: 'cron.removeFromProductMetafields', discountId: discount.discountId, shop }
            );

            // Update the database with products count
            await errorHandler.withErrorHandling(
              () => prisma.discountMetafieldRule.updateMany({
                where: { discountId: discount.discountId, shop: discount.shop },
                data: { productsCount: 0 },
              }),
              { scope: 'cron.updateProductsCount', discountId: discount.discountId, shop }
            );

            // Note: The actual count is logged by the discount service
            // We'll increment by 1 to indicate successful cleanup
            shopMetafieldCleanupCount += 1;
            totalMetafieldCleanupCount += 1;
            logger.info(`Successfully cleaned up expired discount ${discount.discountId} from product metafields and relationships for shop: ${shop}`);

          } catch (metafieldError) {
            logger.error("Failed to clean up metafields and relationships for expired discount", {
              discountId: discount.discountId,
              discountTitle: discount.discountTitle,
              shop,
              error: metafieldError instanceof Error ? metafieldError.message : String(metafieldError),
            });
            // Continue processing other discounts even if metafield cleanup fails
          }

        } catch (error) {
          logger.error("Failed to deactivate expired discount", {
            discountId: discount.discountId,
            discountTitle: discount.discountTitle,
            shop,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      shopResults.push({
        shop,
        processed: shopDiscounts.length,
        deactivated: shopDeactivatedCount,
        metafieldCleanup: shopMetafieldCleanupCount,
        discounts: shopExpiredDiscountData,
      });

      logger.info(`Completed processing shop: ${shop}`, {
        processed: shopDiscounts.length,
        deactivated: shopDeactivatedCount,
        metafieldCleanup: shopMetafieldCleanupCount,
      });
    }

    logger.info("Discount cleanup completed", {
      totalFound: expiredDiscounts.length,
      deactivated: totalDeactivatedCount,
      metafieldCleanupCount: totalMetafieldCleanupCount,
      shopsProcessed: Object.keys(discountsByShop).length,
    });

    return json(errorHandler.createSuccessResponse({
      processed: expiredDiscounts.length,
      expired: allExpiredDiscountData,
      deactivatedCount: totalDeactivatedCount,
      metafieldCleanupCount: totalMetafieldCleanupCount,
      shopsProcessed: Object.keys(discountsByShop).length,
      shopResults,
    }, `Processed ${expiredDiscounts.length} expired discounts across ${Object.keys(discountsByShop).length} shops, deactivated ${totalDeactivatedCount}, cleaned ${totalMetafieldCleanupCount} product metafields`));

  } catch (error) {
    const appError = errorHandler.handleError(error as Error, {
      scope: "cron.discount-cleanup",
      method: request.method,
      url: request.url,
    });

    logger.error("Cron job failed", {
      error: appError.message,
      code: appError.code,
      statusCode: appError.statusCode,
    });

    return json(errorHandler.createErrorResponse(appError), { status: appError.statusCode });
  }
};