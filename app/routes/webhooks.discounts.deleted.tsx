import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { WebhookDiscountProcessor } from "../services/webhookDiscountProcessor.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, session } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    if (!session?.accessToken) {
      console.log("❌ No valid session");
      return new Response("OK", { status: 200 });
    }

    const adminClient = createWebhookAdminWrapper(session);
    const processor = new WebhookDiscountProcessor(adminClient);

    const result = await processor.processDiscountDelete(payload);

    console.log(`🎉 Successfully processed discount deletion:`, {
      id: result.id,
      deleted: result.deleted
    });

  } catch (error) {
    console.error("❌ Error processing discount delete webhook:", error);
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
