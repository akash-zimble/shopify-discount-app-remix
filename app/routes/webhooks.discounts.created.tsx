import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createDiscountServiceStack, createServiceLogger } from "../services/service-factory";
import { ErrorHandlingService, AppError } from "../services/error-handling.service";
import { validationService } from "../services/validation.service";
import { createWebhookAdminClient } from "../utils/webhook-admin.client";

/**
 * Optimized webhook handler for discount creation
 * Follows SOLID principles with proper error handling and validation
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, session } = await authenticate.webhook(request);

  const logger = createServiceLogger("webhook.discounts.created");
  const errorHandler = new ErrorHandlingService(logger);

  try {
    logger.info("Received webhook", { topic, shop });

    // Validate webhook payload
    const payloadValidation = validationService.validateWebhookPayload(payload);
    if (!payloadValidation.isValid) {
      logger.error("Invalid webhook payload", { 
        errors: payloadValidation.errors, 
        warnings: payloadValidation.warnings,
        payload 
      });
      return new Response("Invalid payload", { status: 400 });
    }

    if (!session?.accessToken) {
      logger.warn("No valid session - storing for background processing", { shop });
      return new Response("OK", { status: 200 });
    }

    // Create admin object from session data (webhook approach)
    const admin = createWebhookAdminClient(session);
    
    // Create service stack with proper dependency injection
    const { discountService } = createDiscountServiceStack(admin, "webhook.discounts.created");

    // Process discount creation with error handling
    const result = await errorHandler.withErrorHandling(
      () => discountService.processDiscountCreate(payload),
      { 
        scope: "webhook.discounts.created", 
        topic, 
        shop,
        discountId: payload.admin_graphql_api_id || payload.id 
      }
    );

    logger.info("Processed discount creation", {
      id: result.id,
      title: result.title,
      type: result.discountType,
      code: result.code || "N/A (Automatic)",
      value: result.value.displayValue,
      shop,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    const appError = errorHandler.handleError(error as Error, {
      scope: "webhook.discounts.created",
      topic,
      shop,
      payload: JSON.stringify(payload),
    });

    // Log the error but don't fail the webhook to avoid retries
    logger.error("Webhook processing failed", {
      error: appError.message,
      code: appError.code,
      statusCode: appError.statusCode,
      context: appError.context,
    });

    // Return 200 to prevent webhook retries for operational errors
    // Only return error status for programming errors
    const statusCode = appError.isOperational ? 200 : appError.statusCode;
    return new Response(appError.isOperational ? "OK" : appError.message, { status: statusCode });
  }
};
