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

    // Get the first available session to create admin client
    const session = await prisma.session.findFirst({
      orderBy: { expires: 'desc' }
    });


    if (!session) {
      logger.error("No valid session found for cron job");
      throw new Error("No valid Shopify session found");
    }

    // Create admin client for the cron job
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

    // Create service stack for metafield operations
    const { targetingService, metafieldService } = createDiscountServiceStack(adminClient, 'cron-cleanup');

    // Find expired discounts
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
      }, "No expired discounts found"));
    }

    let deactivatedCount = 0;
    let metafieldCleanupCount = 0;
    const expiredDiscountData = [];

    // Process each expired discount
    for (const discount of expiredDiscounts) {
      try {
        // Deactivate the discount
        await errorHandler.withErrorHandling(
          () => prisma.discountMetafieldRule.updateMany({
            where: { discountId: discount.discountId },
            data: {
              isActive: false,
              status: "EXPIRED",
              lastRan: new Date(),
              updatedAt: new Date(),
            },
          }),
          { scope: "cron.deactivateDiscount", discountId: discount.discountId }
        );

        deactivatedCount++;
        expiredDiscountData.push({
          id: discount.discountId,
          title: discount.discountTitle,
          endDate: discount.endDate,
        });

        logger.info(`Deactivated expired discount: ${discount.discountTitle} (${discount.discountId})`);

        // Remove discount from product metafields
        try {
          logger.info(`Cleaning up expired discount ${discount.discountId} from product metafields...`);
          
          const allProductIds = await errorHandler.withErrorHandling(
            () => targetingService.getAllProductIds(),
            { scope: 'cron.getAllProductIds', discountId: discount.discountId }
          );

          const metafieldResult = await errorHandler.withErrorHandling(
            () => metafieldService.removeDiscountFromMultipleProducts(allProductIds, discount.discountId),
            { scope: 'cron.removeMetafields', discountId: discount.discountId }
          );

          // Update the database with products count
          await errorHandler.withErrorHandling(
            () => prisma.discountMetafieldRule.updateMany({
              where: { discountId: discount.discountId },
              data: { productsCount: 0 },
            }),
            { scope: 'cron.updateProductsCount', discountId: discount.discountId }
          );

          metafieldCleanupCount += metafieldResult.successCount;
          logger.info(`Removed expired discount ${discount.discountId} from ${metafieldResult.successCount} product metafields`);

        } catch (metafieldError) {
          logger.error("Failed to clean up metafields for expired discount", {
            discountId: discount.discountId,
            discountTitle: discount.discountTitle,
            error: metafieldError instanceof Error ? metafieldError.message : String(metafieldError),
          });
          // Continue processing other discounts even if metafield cleanup fails
        }

      } catch (error) {
        logger.error("Failed to deactivate expired discount", {
          discountId: discount.discountId,
          discountTitle: discount.discountTitle,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Discount cleanup completed", {
      totalFound: expiredDiscounts.length,
      deactivated: deactivatedCount,
      metafieldCleanupCount,
    });

    return json(errorHandler.createSuccessResponse({
      processed: expiredDiscounts.length,
      expired: expiredDiscountData,
      deactivatedCount,
      metafieldCleanupCount,
    }, `Processed ${expiredDiscounts.length} expired discounts, deactivated ${deactivatedCount}, cleaned ${metafieldCleanupCount} product metafields`));

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