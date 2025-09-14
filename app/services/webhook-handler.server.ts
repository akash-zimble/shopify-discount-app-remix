import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createDiscountServiceStack, createServiceLogger } from "./service-factory";
import { ErrorHandlingService } from "./error-handling.service";
import { validationService } from "./validation.service";

/**
 * Shared webhook handler utility to eliminate duplication
 * Consolidates common webhook processing logic
 */
export class WebhookHandler {
  private logger: any;
  private errorHandler: ErrorHandlingService;

  constructor(private webhookType: string) {
    this.logger = createServiceLogger(`webhook.discounts.${webhookType}`);
    this.errorHandler = new ErrorHandlingService(this.logger);
  }

  /**
   * Create admin client from session data
   * Inline implementation to avoid Vite/SSR issues
   */
  private createAdminClient(session: any) {
    return {
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
  }

  /**
   * Validate webhook payload
   */
  private validatePayload(payload: any) {
    const payloadValidation = validationService.validateWebhookPayload(payload);
    if (!payloadValidation.isValid) {
      this.logger.error("Invalid webhook payload", { 
        errors: payloadValidation.errors, 
        warnings: payloadValidation.warnings,
        payload 
      });
      return { isValid: false, errors: payloadValidation.errors };
    }
    return { isValid: true };
  }

  /**
   * Handle webhook processing with common logic
   */
  async handleWebhook(
    request: ActionFunctionArgs['request'],
    processFunction: (discountService: any, payload: any) => Promise<any>
  ) {
    const { topic, shop, payload, session } = await authenticate.webhook(request);

    try {
      this.logger.info("Received webhook", { topic, shop });

      // Validate webhook payload
      const validation = this.validatePayload(payload);
      if (!validation.isValid) {
        return new Response("Invalid payload", { status: 400 });
      }

      if (!session?.accessToken) {
        this.logger.warn("No valid session - storing for background processing", { shop });
        return new Response("OK", { status: 200 });
      }

      // Create admin client and service stack
      const admin = this.createAdminClient(session);
      const { discountService } = createDiscountServiceStack(admin, `webhook.discounts.${this.webhookType}`);

      // Process the webhook with the provided function
      const result = await this.errorHandler.withErrorHandling(
        () => processFunction(discountService, payload),
        { 
          scope: `webhook.discounts.${this.webhookType}`, 
          topic, 
          shop,
          discountId: payload.admin_graphql_api_id || payload.id 
        }
      );

      // Log success
      this.logger.info(`Processed discount ${this.webhookType}`, {
        id: result.id,
        title: result.title || 'N/A',
        type: result.discountType || 'N/A',
        status: result.status || 'N/A',
        code: result.code || "N/A (Automatic)",
        value: result.value?.displayValue || 'N/A',
        deleted: result.deleted || false,
        shop,
      });

      return new Response("OK", { status: 200 });
    } catch (error) {
      const appError = this.errorHandler.handleError(error as Error, {
        scope: `webhook.discounts.${this.webhookType}`,
        topic,
        shop,
        payload: JSON.stringify(payload),
      });

      // Log the error but don't fail the webhook to avoid retries
      this.logger.error("Webhook processing failed", {
        error: appError.message,
        code: appError.code,
        statusCode: appError.statusCode,
        context: appError.context,
      });

      // Return 200 to prevent webhook retries for operational errors
      const statusCode = appError.isOperational ? 200 : appError.statusCode;
      return new Response(appError.isOperational ? "OK" : appError.message, { status: statusCode });
    }
  }
}

/**
 * Convenience function to create webhook handlers
 */
export function createWebhookHandler(webhookType: string) {
  return new WebhookHandler(webhookType);
}
