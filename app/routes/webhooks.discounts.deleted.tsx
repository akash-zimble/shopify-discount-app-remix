import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { WebhookDiscountProcessor } from "../services/webhookDiscountProcessor.server";
import { createLogger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, session } = await authenticate.webhook(request);

  const logger = createLogger({ name: "webhook.discounts.deleted" });
  logger.info("Received webhook", { topic, shop });

  try {
    if (!session?.accessToken) {
      logger.warn("No valid session", { shop });
      return new Response("OK", { status: 200 });
    }

    const adminClient = createWebhookAdminWrapper(session);
    const processor = new WebhookDiscountProcessor(adminClient, logger);

    const result = await processor.processDiscountDelete(payload);

    logger.info("Processed discount deletion", {
      id: result.id,
      deleted: result.deleted
    });

  } catch (error) {
    const logger = createLogger({ name: "webhook.discounts.deleted" });
    logger.error(error as Error, { scope: "action" });
  }

  return new Response("OK", { status: 200 });
};

function createWebhookAdminWrapper(session: any) {
  return {
    graphql: async (query: string, options: any = {}) => {
      const url = `https://${session.shop}/admin/api/2025-07/graphql.json`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken
        },
        body: JSON.stringify({
          query: query,
          variables: options.variables || {}
        })
      });

      return response;
    }
  } as any;
}
