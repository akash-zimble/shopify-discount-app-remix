import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("PAYLOAD:", JSON.stringify(payload, null, 2));

    try {
        const discount = payload;

        const discountId = discount.admin_graphql_api_id ?
            discount.admin_graphql_api_id.split('/').pop() :
            discount.id;

        if (!discountId) {
            console.log("❌ No discount ID found in payload");
            return new Response("OK", { status: 200 });
        }

        await prisma.discountMetafieldRule.create({
            data: {
                discountId: String(discountId),
                discountType: discount.code ? "code" : "automatic",
                discountTitle: discount.title || discount.code || "Untitled Discount",
                metafieldNamespace: "discount_manager",
                metafieldKey: "active_discounts",
                metafieldValue: JSON.stringify({
                    id: discountId,
                    title: discount.title,
                    code: discount.code,
                    status: discount.status,
                    created_at: discount.created_at
                }),
                isActive: true
            }
        });

        console.log(`✅ Created metafield rule for discount: ${discount.title || discountId}`);

    } catch (error) {
        console.error("❌ Error creating discount metafield rule:", error);
    }

    return new Response("OK", { status: 200 });
};
