import prisma from "../db.server";
import { DiscountProductMatcher } from "./discountProductMatcher.server";
import { DiscountDataExtractor } from "./discountDataExtractor.server";
import type { Logger } from "../utils/logger.server";

export class WebhookDiscountProcessor {
  private adminClient: any;
  private logger: Logger;

  constructor(adminClient: any, logger: Logger) {
    this.adminClient = adminClient;
    this.logger = logger;
  }

  async processDiscountCreate(payload: any) {
    const discountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;

    if (!discountId) {
      throw new Error("No discount ID found in payload");
    }

    const existingRule = await prisma.discountMetafieldRule.findFirst({
      where: { discountId: String(discountId), isActive: true }
    });

    const fullDiscountDetails = await this.fetchFullDiscountDetails(payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`);
    this.logger.debug("Full discount details (create)", { fullDiscountDetails });
    if (fullDiscountDetails?.discount?.customerGets?.value) {
      const v = fullDiscountDetails.discount.customerGets.value;
      this.logger.debug("Discount value (create)", { typename: v.__typename, value: v });
    } else {
      this.logger.warn("No discount value found in full details (create)", { discountId });
    }

    const extractedData = fullDiscountDetails
      ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails.discount)
      : DiscountDataExtractor.extractFromWebhookPayload(payload);

    // Ensure we have a stable discount id to store in product metafields
    const originalExtractedId = extractedData.id;
    const fallbackNumericId = String(discountId || '').trim();
    const nodeIdTail = fullDiscountDetails?.nodeId ? String(fullDiscountDetails.nodeId).split('/').pop() : '';
    if (!originalExtractedId || originalExtractedId.length === 0) {
      extractedData.id = nodeIdTail || fallbackNumericId;
      this.logger.warn("Missing discount id in extracted data (create) - applied fallback", { originalExtractedId, nodeIdTail, fallbackNumericId, finalId: extractedData.id });
    }
    if (!extractedData.id) {
      this.logger.error("Discount id is still empty after fallback (create)", { discountId, nodeId: fullDiscountDetails?.nodeId });
    }
    this.logger.debug("Extracted discount data (create)", { id: extractedData.id, type: extractedData.type, displayValue: extractedData.value?.displayValue, rawValue: extractedData.value });

    // Check status before proceeding - only add/update if ACTIVE
    if (extractedData.status !== 'ACTIVE') {
      this.logger.info("Discount created but not ACTIVE - skipping metafield updates", { discountId, status: extractedData.status });
      if (existingRule) {
        await prisma.discountMetafieldRule.updateMany({
          where: { discountId: String(discountId) },
          data: {
            isActive: false,
            lastRan: new Date() // NEW: Set lastRan
          }
        });
      } else {
        await prisma.discountMetafieldRule.create({
          data: {
            discountId: String(discountId),
            discountType: extractedData.discountType,
            discountTitle: extractedData.title,
            metafieldNamespace: "discount_manager",
            metafieldKey: "active_discounts",
            metafieldValue: JSON.stringify(extractedData),
            isActive: false,
            lastRan: new Date(), // NEW: Set lastRan
            discountValue: extractedData.value?.displayValue || null,
            discountValueType: extractedData.type || null,
            status: extractedData.status || "ACTIVE",
            startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
            endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null,
            productsCount: 0
          }
        });
      }
      return extractedData;
    }

    if (existingRule) {
      await prisma.discountMetafieldRule.updateMany({
        where: { discountId: String(discountId) },
        data: {
          discountTitle: extractedData.title,
          metafieldValue: JSON.stringify(extractedData),
          isActive: true,
          lastRan: new Date(), // NEW: Set lastRan
          discountValue: extractedData.value?.displayValue || null,
          discountValueType: extractedData.type || null,
          status: extractedData.status || "ACTIVE",
          startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
          endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null
        }
      });
      this.logger.info("Updated existing metafield rule on create", { discountId });
    } else {
      await prisma.discountMetafieldRule.create({
        data: {
          discountId: String(discountId),
          discountType: extractedData.discountType,
          discountTitle: extractedData.title,
          metafieldNamespace: "discount_manager",
          metafieldKey: "active_discounts",
          metafieldValue: JSON.stringify(extractedData),
          isActive: true,
          lastRan: new Date(), // NEW: Set lastRan
          discountValue: extractedData.value?.displayValue || null,
          discountValueType: extractedData.type || null,
          status: extractedData.status || "ACTIVE",
          startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
          endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null,
          productsCount: 0
        }
      });
      this.logger.info("Created metafield rule on create", { discountId });
    }

    this.logger.info("Upserted metafield rule", { discountType: extractedData.discountType, title: extractedData.title, discountId });

    // Update product metafields
    await this.updateAffectedProductMetafields(payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`, extractedData);

    return extractedData;
  }

  async processDiscountUpdate(payload: any) {
    const discountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;

    if (!discountId) {
      throw new Error("No discount ID found in payload");
    }

    // Fetch full discount details
    const fullDiscountDetails = await this.fetchFullDiscountDetails(payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`);
    this.logger.debug("Full discount details (update)", { fullDiscountDetails });
    if (fullDiscountDetails?.discount?.customerGets?.value) {
      const v = fullDiscountDetails.discount.customerGets.value;
      this.logger.debug("Discount value (update)", { typename: v.__typename, value: v });
    } else {
      this.logger.warn("No discount value found in full details (update)", { discountId });
    }

    // Extract structured data
    const extractedData = fullDiscountDetails
      ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails.discount)
      : DiscountDataExtractor.extractFromWebhookPayload(payload);
    // Ensure we have a stable discount id to store in product metafields
    const originalExtractedIdU = extractedData.id;
    const fallbackNumericIdU = String(discountId || '').trim();
    const nodeIdTailU = fullDiscountDetails?.nodeId ? String(fullDiscountDetails.nodeId).split('/').pop() : '';
    if (!originalExtractedIdU || originalExtractedIdU.length === 0) {
      extractedData.id = nodeIdTailU || fallbackNumericIdU;
      this.logger.warn("Missing discount id in extracted data (update) - applied fallback", { originalExtractedId: originalExtractedIdU, nodeIdTail: nodeIdTailU, fallbackNumericId: fallbackNumericIdU, finalId: extractedData.id });
    }
    if (!extractedData.id) {
      this.logger.error("Discount id is still empty after fallback (update)", { discountId, nodeId: fullDiscountDetails?.nodeId });
    }
    this.logger.debug("Extracted discount data (update)", { id: extractedData.id, type: extractedData.type, displayValue: extractedData.value?.displayValue, rawValue: extractedData.value });

    // Fetch existing rule once for reuse
    const existingRule = await prisma.discountMetafieldRule.findFirst({
      where: { discountId: String(discountId) }
    });

    // Check status - if not ACTIVE, treat as deletion (remove from metafields, set isActive: false)
    if (extractedData.status !== 'ACTIVE') {
      this.logger.info("Discount updated but not ACTIVE - treating as removal", { discountId, status: extractedData.status });
      if (existingRule) {
        await prisma.discountMetafieldRule.updateMany({
          where: { discountId: String(discountId) },
          data: {
            metafieldValue: JSON.stringify(extractedData), // Optional: Update value for record-keeping
            isActive: false,
            lastRan: new Date(), // NEW: Set lastRan
            status: extractedData.status || "EXPIRED" // Ensure status is updated
          }
        });
        await this.removeFromProductMetafields(existingRule, String(discountId));
      }
      return extractedData;
    }

    // Normal update for ACTIVE discounts
    const updated = await prisma.discountMetafieldRule.updateMany({
      where: { discountId: String(discountId) },
      data: {
        discountTitle: extractedData.title,
        metafieldValue: JSON.stringify(extractedData),
        isActive: true,
        lastRan: new Date(), // NEW: Set lastRan
        discountValue: extractedData.value?.displayValue || null,
        discountValueType: extractedData.type || null,
        status: extractedData.status || "ACTIVE",
        startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
        endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null
      }
    });

    if (updated.count === 0) {
      // Create if doesn't exist
      await prisma.discountMetafieldRule.create({
        data: {
          discountId: String(discountId),
          discountType: extractedData.discountType,
          discountTitle: extractedData.title,
          metafieldNamespace: "discount_manager",
          metafieldKey: "active_discounts",
          metafieldValue: JSON.stringify(extractedData),
          isActive: true,
          lastRan: new Date(), // NEW: Set lastRan
          discountValue: extractedData.value?.displayValue || null,
          discountValueType: extractedData.type || null,
          status: extractedData.status || "ACTIVE",
          startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
          endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null,
          productsCount: 0
        }
      });
    }

    this.logger.info("Updated metafield rule", { discountType: extractedData.discountType, title: extractedData.title, discountId });

    // Update product metafields
    await this.updateAffectedProductMetafields(payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`, extractedData);

    return extractedData;
  }

  async processDiscountDelete(payload: any) {
    const discountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;

    if (!discountId) {
      throw new Error("No discount ID found in payload");
    }

    // Get existing rule before deactivating
    const existingRule = await prisma.discountMetafieldRule.findFirst({
      where: { discountId: String(discountId), isActive: true }
    });

    // Deactivate rule
    await prisma.discountMetafieldRule.updateMany({
      where: { discountId: String(discountId) },
      data: {
        isActive: false,
        status: "DELETED", // Update status to DELETED
        lastRan: new Date() // NEW: Set lastRan
      }
    });

    this.logger.info(`✅ Deactivated metafield rule for deleted discount: ${discountId}`);

    // Remove from product metafields
    if (existingRule) {
      await this.removeFromProductMetafields(existingRule, discountId);
    }

    return { id: discountId, deleted: true };
  }

  private async fetchFullDiscountDetails(discountGraphqlId: string) {
    try {
      const candidates: string[] = this.buildDiscountIdCandidates(discountGraphqlId);
      // Try generic node(id: ...) with the provided/admin id
      for (const id of candidates) {
        const nodeResp = await this.adminClient.graphql(`
          #graphql
          query getDiscountNode($id: ID!) {
            node(id: $id) {
              __typename
              ... on DiscountCodeBasic {
                __typename
                title
                summary
                status
                startsAt
                endsAt
                codes(first: 1) { edges { node { code } } }
                customerGets {
                  value {
                    ... on DiscountAmount { __typename amount { amount currencyCode } }
                    ... on DiscountPercentage { __typename percentage }
                  }
                  items {
                    ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                    ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                    ... on AllDiscountItems { allItems }
                  }
                }
              }
              ... on DiscountAutomaticBasic {
                __typename
                title
                summary
                status
                startsAt
                endsAt
                customerGets {
                  value {
                    ... on DiscountAmount { __typename amount { amount currencyCode } }
                    ... on DiscountPercentage { __typename percentage }
                  }
                  items {
                    ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                    ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                    ... on AllDiscountItems { allItems }
                  }
                }
              }
              ... on DiscountAutomaticBxgy {
                __typename
                title
                summary
                status
                startsAt
                endsAt
                customerGets {
                  value {
                    ... on DiscountAmount { __typename amount { amount currencyCode } }
                    ... on DiscountPercentage { __typename percentage }
                  }
                  items {
                    ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                    ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                    ... on AllDiscountItems { allItems }
                  }
                }
                customerBuys {
                  items {
                    ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                    ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                    ... on AllDiscountItems { allItems }
                  }
                }
              }
            }
          }
        `, { variables: { id } });
        const nodeData = await nodeResp.json();
        const typename = nodeData.data?.node?.__typename;
        if (typename === 'DiscountCodeBasic' || typename === 'DiscountAutomaticBasic' || typename === 'DiscountAutomaticBxgy') {
          this.logger.debug("Fetched discount via node()", { id, typename });
          try { this.logger.debug("Full discount payload", { discount: nodeData.data.node }); } catch {}
          return { nodeId: nodeData.data.node.id, discount: nodeData.data.node };
        }
      }
      // Fallback: try discountNode(id: DiscountNodeGid)
      for (const id of candidates) {
        const dnId = id.includes('/DiscountAutomatic') || id.includes('/DiscountCode') ? id.replace(/Discount\w+Node\//, 'DiscountNode/') : id;
        const response = await this.adminClient.graphql(`
          #graphql
          query getFullDiscountDetails($id: ID!) {
            discountNode(id: $id) {
              id
              discount {
                __typename
                ... on DiscountCodeBasic {
                  __typename
                  title
                  summary
                  status
                  startsAt
                  endsAt
                  codes(first: 1) { edges { node { code } } }
                  customerGets {
                    value {
                      ... on DiscountAmount { __typename amount { amount currencyCode } }
                      ... on DiscountPercentage { __typename percentage }
                    }
                    items {
                      ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                      ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                      ... on AllDiscountItems { allItems }
                    }
                  }
                }
                ... on DiscountAutomaticBasic {
                  __typename
                  title
                  summary
                  status
                  startsAt
                  endsAt
                  customerGets {
                    value {
                      ... on DiscountAmount { __typename amount { amount currencyCode } }
                      ... on DiscountPercentage { __typename percentage }
                    }
                    items {
                      ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                      ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                      ... on AllDiscountItems { allItems }
                    }
                  }
                }
                ... on DiscountAutomaticBxgy {
                  __typename
                  title
                  summary
                  status
                  startsAt
                  endsAt
                  customerGets {
                    value {
                      ... on DiscountAmount { __typename amount { amount currencyCode } }
                      ... on DiscountPercentage { __typename percentage }
                    }
                    items {
                      ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                      ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                      ... on AllDiscountItems { allItems }
                    }
                  }
                  customerBuys {
                    items {
                      ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                      ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                      ... on AllDiscountItems { allItems }
                    }
                  }
                }
              }
            }
          }
        `, { variables: { id: dnId } });
        const data = await response.json();
        if (data.errors) {
          this.logger.warn("GraphQL errors from discountNode", { id: dnId, errors: data.errors });
        }
        if (data.data?.discountNode?.discount) {
          this.logger.debug("Fetched full discount details via discountNode", { id: dnId, typename: data.data.discountNode.discount.__typename });
          try { this.logger.debug("Full discount payload", { discount: data.data.discountNode.discount }); } catch {}
          return { nodeId: data.data.discountNode.id, discount: data.data.discountNode.discount };
        }
      }
      this.logger.warn("Failed to fetch full discount details with candidates", { candidates });
      return null;
    } catch (error) {
      this.logger.error(error as Error, { scope: "fetchFullDiscountDetails", discountGraphqlId });
      return null;
    }
  }

  private buildDiscountIdCandidates(inputId: string): string[] {
    if (!inputId) return [];
    const parts = inputId.split('/');
    const tail = parts[parts.length - 1];
    const coreId = tail || inputId;
    const candidates = [
      `gid://shopify/DiscountAutomaticNode/${coreId}`,
      `gid://shopify/DiscountCodeNode/${coreId}`,
      `gid://shopify/DiscountNode/${coreId}`
    ];
    const set = new Set<string>(candidates);
    set.add(inputId);
    return Array.from(set);
  }

  private async updateAffectedProductMetafields(discountGraphqlId: string, extractedData: any) {
    try {
      const matcher = new DiscountProductMatcher(this.adminClient, this.logger);
      const affectedProducts = await matcher.getAffectedProducts(discountGraphqlId);

      this.logger.info("Found affected products", { discountGraphqlId, count: affectedProducts.length });

      let updateCount = 0;
      const maxProducts = Math.min(affectedProducts.length, 10);

      for (let i = 0; i < maxProducts; i++) {
        try {
          const success = await matcher.updateProductMetafield(affectedProducts[i], extractedData);
          if (success) updateCount++;
          // Increased rate limiting to prevent API throttling
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          this.logger.error(error as Error, { scope: "updateAffectedProductMetafields", productId: affectedProducts[i], discountId: extractedData.id });
          // Continue processing other products even if one fails
        }
      }

      // Update the products count in the database
      try {
        await prisma.discountMetafieldRule.updateMany({
          where: { discountId: String(extractedData.id) },
          data: {
            productsCount: affectedProducts.length,
            lastRan: new Date() // NEW: Set lastRan
          }
        });
      } catch (error) {
        this.logger.error(error as Error, { scope: "updateProductsCount", discountId: extractedData.id });
      }

      this.logger.info("Updated product metafields", { updated: updateCount, attempted: maxProducts });
    } catch (error) {
      this.logger.error(error as Error, { scope: "updateAffectedProductMetafields.root" });
    }
  }

  private async removeFromProductMetafields(existingRule: any, discountId: string) {
    try {
      try {
        JSON.parse(existingRule.metafieldValue);
      } catch (error) {
        this.logger.warn("Could not parse stored discount details", { discountId, metafieldValue: existingRule.metafieldValue });
      }

      const matcher = new DiscountProductMatcher(this.adminClient, this.logger);
      const affectedProducts = await matcher.getAffectedProducts(discountId);
      const productsToProcess = affectedProducts.length > 0 ? affectedProducts : await matcher.getAllProductIds();

      let removalCount = 0;
      const maxProducts = Math.min(productsToProcess.length, 20);

      for (let i = 0; i < maxProducts; i++) {
        try {
          const success = await matcher.removeDiscountFromProduct(productsToProcess[i], String(discountId));
          if (success) removalCount++;
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          this.logger.error(error as Error, { scope: "removeFromProductMetafields", productId: productsToProcess[i], discountId });
        }
      }

      // NEW: Update lastRan after successful removals
      try {
        await prisma.discountMetafieldRule.updateMany({
          where: { discountId: String(discountId) },
          data: { lastRan: new Date() }
        });
      } catch (error) {
        this.logger.error(error as Error, { scope: "updatelastRanAfterRemove", discountId });
      }

      this.logger.info("Removed discount from products", { removed: removalCount, attempted: maxProducts });
    } catch (error) {
      this.logger.error(error as Error, { scope: "removeFromProductMetafields.root", discountId });
    }
  }
}