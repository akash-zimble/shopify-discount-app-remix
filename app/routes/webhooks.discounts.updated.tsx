import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("UPDATE PAYLOAD:", JSON.stringify(payload, null, 2));

  try {
    const discount = payload;
    const discountId = discount.admin_graphql_api_id ?
    discount.admin_graphql_api_id.split('/').pop() :
    discount.id;
    
    if (!discountId) {
      console.log("❌ No discount ID found in update payload");
      return new Response("OK", { status: 200 });
    }

    // Update existing rule or create if it doesn't exist
    await prisma.discountMetafieldRule.upsert({
      where: {
        id: -1, // This will never match, forcing create behavior for upsert
      },
      update: {},
      create: {
        discountId: String(discountId),
        discountType: discount.code ? "code" : "automatic",
        discountTitle: discount.title || discount.code || "Updated Discount",
        metafieldNamespace: "discount_manager",
        metafieldKey: "active_discounts",
        metafieldValue: JSON.stringify({
          id: discountId,
          title: discount.title,
          code: discount.code,
          status: discount.status,
          updated_at: new Date().toISOString()
        }),
        isActive: true
      }
    });

    console.log(`✅ Updated metafield rule for discount: ${discount.title || discountId}`);
    
  } catch (error) {
    console.error("❌ Error updating discount metafield rule:", error);
  }

  return new Response("OK", { status: 200 });
};
