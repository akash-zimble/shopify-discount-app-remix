import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createServiceStack, createServiceLogger } from "./service-factory";
import { ErrorHandlingService } from "./error-handling.service";
import { validationService } from "./validation.service";

/**
 * Product webhook handler utility
 * Consolidates common product webhook processing logic
 */
export class ProductWebhookHandler {
  private logger: any;
  private errorHandler: ErrorHandlingService;

  constructor(private webhookType: string) {
    this.logger = createServiceLogger(`webhook.products.${webhookType}`);
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
    if (!payload || !payload.id) {
      this.logger.error("Invalid payload: missing required fields", { payload });
      return { isValid: false, error: "Missing required fields" };
    }

    return { isValid: true };
  }

  /**
   * Handle webhook processing with common logic
   */
  async handleWebhook(
    request: ActionFunctionArgs['request'],
    processFunction: (productService: any, payload: any) => Promise<any>
  ) {
    const { topic, shop, payload, session } = await authenticate.webhook(request);

    try {
      this.logger.info("Received product webhook", { topic, shop });

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
      const { productService } = createServiceStack(admin, `webhook.products.${this.webhookType}`, shop);

      // Process the webhook with the provided function
      const result = await this.errorHandler.withErrorHandling(
        () => processFunction(productService, payload),
        { 
          scope: `webhook.products.${this.webhookType}`, 
          topic, 
          shop,
          productId: payload.id 
        }
      );

      // Log success
      this.logger.info(`Processed product ${this.webhookType}`, {
        id: result.id || result.shopifyId,
        title: result.title || 'N/A',
        shopifyId: result.shopifyId || 'N/A',
        deleted: result.deleted || false,
        shop,
      });

      return new Response("OK", { status: 200 });
    } catch (error) {
      const appError = this.errorHandler.handleError(error as Error, {
        scope: `webhook.products.${this.webhookType}`,
        topic,
        shop,
        productId: payload?.id
      });

      return new Response(appError.message, { status: appError.statusCode });
    }
  }
}

/**
 * Convenience function to create product webhook handlers
 */
export function createProductWebhookHandler(webhookType: string) {
  return new ProductWebhookHandler(webhookType);
}
