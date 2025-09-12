import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createServiceLogger } from "../services/service-factory";
import { ErrorHandlingService, UnauthorizedError } from "../services/error-handling.service";
import { configurationService } from "../services/configuration.service";
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

        // Note: In a production system, you might also want to remove the discount
        // from product metafields here, but that would require Shopify API access
        // which might not be available in a cron context

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
    });

    return json(errorHandler.createSuccessResponse({
      processed: expiredDiscounts.length,
      expired: expiredDiscountData,
      deactivatedCount,
    }, `Processed ${expiredDiscounts.length} expired discounts, deactivated ${deactivatedCount}`));

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