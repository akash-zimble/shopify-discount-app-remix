import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("DELETE PAYLOAD:", JSON.stringify(payload, null, 2));

  try {
    const discount = payload;
    const discountId = discount.admin_graphql_api_id ?
      discount.admin_graphql_api_id.split('/').pop() :
      discount.id;

    if (!discountId) {
      console.log("❌ No discount ID found in delete payload");
      return new Response("OK", { status: 200 });
    }

    await prisma.discountMetafieldRule.updateMany({
      where: {
        discountId: String(discountId),
      },
      data: {
        isActive: false,
      },
    });

    console.log(`✅ Deactivated metafield rule for deleted discount: ${discountId}`);

  } catch (error) {
    console.error("❌ Error handling discount deletion:", error);
  }

  return new Response("OK", { status: 200 });
};
