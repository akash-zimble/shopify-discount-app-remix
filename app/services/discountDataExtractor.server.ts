/**
 * Discount Data Extractor
 * Extracts and normalizes discount data from various sources
 * This file contains the core data extraction logic that was moved from the old service
 */

export interface ExtractedDiscountData {
  id: string;
  title: string;
  code: string;
  value: any;
  type: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  discountType: "code" | "automatic";
  summary?: string;
  customerEligibility?: "all" | "segment" | "specific";
  posExcluded?: boolean;
  canCombine?: boolean;
  minimumRequirement?: { type: "amount" | "quantity" | "none"; value?: number; currencyCode?: string };
  appliesTo?: "one_time" | "subscriptions" | "both";
  details?: string[];
}

/**
 * Utility function to normalize discount IDs
 */
export function normalizeDiscountId(id: string): string {
  if (!id) return "";
  
  // If it's already a numeric string, return as is
  if (/^\d+$/.test(id)) {
    return id;
  }
  
  // If it's a GraphQL ID, extract the numeric part
  if (id.includes('/')) {
    const parts = id.split('/');
    const numericPart = parts[parts.length - 1];
    if (/^\d+$/.test(numericPart)) {
      return numericPart;
    }
  }
  
  // Fallback: return the original ID
  return id;
}

/**
 * Discount Data Extractor class
 * Handles extraction of discount data from various sources
 */
export class DiscountDataExtractor {
  /**
   * Extract discount data from full GraphQL response
   */
  static extractFromFullDetails(discountDetails: any): ExtractedDiscountData {
    // Extract code (only exists for code-based discounts)
    const code = discountDetails.codes?.edges?.[0]?.node?.code || "";
    
    // Extract value information
    const customerGets = discountDetails.customerGets || {};
    const value = customerGets.value || {};
    
    // Debug breadcrumbs for value extraction
    if (process.env.NODE_ENV !== 'production') {
      try { 
        console.info(JSON.stringify({ 
          logger: 'extractor', 
          ts: new Date().toISOString(), 
          message: 'Extractor input', 
          typename: value.__typename, 
          value 
        })); 
      } catch {}
    }
    
    // Determine discount type
    let discountType: "code" | "automatic" = "automatic";
    let valueAmount = "";
    let valueType = "unknown";
    const typename = discountDetails.__typename;
    
    if (code) {
      discountType = "code";
    }
    
    // Extract value details based on type
    if (typename === 'DiscountAutomaticBxgy' || discountDetails?.__typename === 'DiscountAutomaticBxgy') {
      valueType = "bxgy";
      // Prefer human-friendly summary for BxGy
      valueAmount = discountDetails.summary || "Buy X Get Y";
    } else if (value.__typename === "DiscountPercentage") {
      valueType = "percentage";
      const pct = typeof value.percentage === "number" ? value.percentage : Number(value.percentage);
      const displayPct = pct > 1 ? pct : pct * 100;
      valueAmount = `${displayPct}%`;
    } else if (value.__typename === "DiscountAmount") {
      valueType = "fixed_amount";
      valueAmount = `${value.amount?.amount || 0} ${value.amount?.currencyCode || ""}`;
    }

    const details: string[] = [];
    if (valueType === "percentage" && valueAmount) details.push(`${valueAmount} off`);
    if (valueType === "bxgy" && valueAmount) details.push(valueAmount);
    if (discountDetails.startsAt) details.push("Active from today");
    if (typename === 'DiscountAutomaticBxgy') details.push("Buy X Get Y");
    
    const customerEligibility: "all" | "segment" | "specific" = "all";
    const posExcluded = undefined as unknown as boolean | undefined;
    const canCombine = undefined as unknown as boolean | undefined;
    const minimumRequirement: { type: "amount" | "quantity" | "none"; value?: number; currencyCode?: string } = { type: "none" };
    const appliesTo: "one_time" | "subscriptions" | "both" = "one_time";
    
    details.unshift("All customers");
    
    if (process.env.NODE_ENV !== 'production') {
      try { 
        console.info(JSON.stringify({ 
          logger: 'extractor', 
          ts: new Date().toISOString(), 
          message: 'Extractor output', 
          type: valueType, 
          displayValue: valueAmount 
        })); 
      } catch {}
    }
    
    // Generate a better fallback title if none is provided
    let title = discountDetails.title;
    if (!title || title.trim() === "") {
      const discountType = typename?.replace('Discount', '') || 'Unknown';
      const valueInfo = valueAmount ? ` (${valueAmount})` : '';
      title = `${discountType} Discount${valueInfo}`;
    }

    return {
      id: "", // Will be set by ensureStableDiscountId
      title: title,
      code: code,
      value: {
        ...value,
        displayValue: valueAmount
      },
      type: valueType,
      status: discountDetails.status || "ACTIVE",
      startsAt: discountDetails.startsAt,
      endsAt: discountDetails.endsAt,
      usageLimit: discountDetails.usageLimit,
      discountType: discountType,
      summary: discountDetails.summary || "",
      customerEligibility,
      posExcluded,
      canCombine,
      minimumRequirement,
      appliesTo,
      details
    };
  }
  
  /**
   * Extract discount data from webhook payload
   */
  static extractFromWebhookPayload(payload: any): ExtractedDiscountData {
    // Fallback extraction from minimal webhook data
    const rawId = payload.admin_graphql_api_id?.split('/').pop() || payload.id || "";
    
    // Generate a better fallback title if none is provided
    let title = payload.title;
    if (!title || title.trim() === "") {
      const discountId = rawId ? ` (${rawId})` : '';
      title = `Webhook Discount${discountId}`;
    }
    
    return {
      id: normalizeDiscountId(rawId),
      title: title,
      code: "", // Webhook doesn't provide codes
      value: {
        displayValue: "Unknown"
      },
      type: "unknown",
      status: payload.status || "ACTIVE",
      startsAt: payload.created_at,
      endsAt: "",
      usageLimit: 0,
      discountType: "automatic", // Assume automatic from webhook
      summary: payload.summary || "",
      customerEligibility: "all",
      appliesTo: "one_time",
      minimumRequirement: { type: "none" },
      details: []
    };
  }
}
