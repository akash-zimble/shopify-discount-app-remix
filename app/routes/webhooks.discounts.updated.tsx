import type { ActionFunctionArgs } from "@remix-run/node";
import { createWebhookHandler } from "../services/webhook-handler.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookHandler = createWebhookHandler("updated");
  
  return webhookHandler.handleWebhook(request, async (discountService, payload) => {
    return await discountService.processDiscountUpdate(payload);
  });
};
