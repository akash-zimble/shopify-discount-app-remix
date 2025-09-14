import type { ActionFunctionArgs } from "@remix-run/node";
import { createProductWebhookHandler } from "../services/product-webhook-handler.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookHandler = createProductWebhookHandler("created");
  
  return webhookHandler.handleWebhook(request, async (productService, payload) => {
    return await productService.processProductCreate(payload);
  });
};
