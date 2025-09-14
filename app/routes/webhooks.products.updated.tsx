import type { ActionFunctionArgs } from "@remix-run/node";
import { createProductWebhookHandler } from "../services/product-webhook-handler.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookHandler = createProductWebhookHandler("updated");
  
  return webhookHandler.handleWebhook(request, async (productService, payload) => {
    return await productService.processProductUpdate(payload);
  });
};
