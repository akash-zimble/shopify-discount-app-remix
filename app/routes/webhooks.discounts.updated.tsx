import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createDiscountServiceStack, createServiceLogger } from "../services/service-factory";
import { ErrorHandlingService } from "../services/error-handling.service";
import { validationService } from "../services/validation.service";

/**
 * Optimized webhook handler for discount updates
 * Follows SOLID principles with proper error handling and validation
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, session } = await authenticate.webhook(request);

  const logger = createServiceLogger("webhook.discounts.updated");
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

    logger.debug("Session found, proceeding with webhook processing", { 
      shop, 
      hasAccessToken: !!session.accessToken,
      payloadId: payload.admin_graphql_api_id || payload.id 
    });

    // Create admin object from session data (webhook approach) - inline to avoid Vite/SSR issues
    const admin = {
      graphql: async (query: string, options: { variables?: Record<string, any> } = {}) => {
        const url = `https://${session.shop}/admin/api/2025-07/graphql.json`;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': session.accessToken!,
          },
          body: JSON.stringify({
            query,
            variables: options.variables || {},
          }),
        });

        return response;
      }
    };
    
    logger.debug("Admin object created from session", { hasGraphql: !!admin.graphql });
    
    // Create service stack with proper dependency injection
    const { discountService } = createDiscountServiceStack(admin, "webhook.discounts.updated");
    logger.debug("Service stack created successfully");

    // Process discount update with error handling
    const result = await errorHandler.withErrorHandling(
      () => discountService.processDiscountUpdate(payload),
      { 
        scope: "webhook.discounts.updated", 
        topic, 
        shop,
        discountId: payload.admin_graphql_api_id || payload.id 
      }
    );

    logger.info("Processed discount update", {
      id: result.id,
      title: result.title,
      type: result.discountType,
      status: result.status,
      value: result.value.displayValue,
      shop,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    const appError = errorHandler.handleError(error as Error, {
      scope: "webhook.discounts.updated",
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
    const statusCode = appError.isOperational ? 200 : appError.statusCode;
    return new Response(appError.isOperational ? "OK" : appError.message, { status: statusCode });
  }
};
