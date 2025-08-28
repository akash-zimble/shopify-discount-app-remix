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
  }
  
  export class DiscountDataExtractor {
    static extractFromFullDetails(discountDetails: any): ExtractedDiscountData {
      // Extract code (only exists for code-based discounts)
      const code = discountDetails.codes?.edges?.[0]?.node?.code || "";
      
      // Extract value information
      const customerGets = discountDetails.customerGets || {};
      const value = customerGets.value || {};
      // Debug breadcrumbs for value extraction
      if (process.env.NODE_ENV !== 'production') {
        try { console.info(JSON.stringify({ logger: 'extractor', ts: new Date().toISOString(), message: 'Extractor input', typename: value.__typename, value })); } catch {}
      }
      
      // Determine discount type
      let discountType: "code" | "automatic" = "automatic";
      let valueAmount = "";
      let valueType = "unknown";
      
      if (code) {
        discountType = "code";
      }
      
      // Extract value details based on type
      if (value.__typename === "DiscountPercentage") {
        valueType = "percentage";
        const pct = typeof value.percentage === "number" ? value.percentage : Number(value.percentage);
        const displayPct = pct > 1 ? pct : pct * 100;
        valueAmount = `${displayPct}%`;
      } else if (value.__typename === "DiscountAmount") {
        valueType = "fixed_amount";
        valueAmount = `${value.amount?.amount || 0} ${value.amount?.currencyCode || ""}`;
      }
      if (process.env.NODE_ENV !== 'production') {
        try { console.info(JSON.stringify({ logger: 'extractor', ts: new Date().toISOString(), message: 'Extractor output', type: valueType, displayValue: valueAmount })); } catch {}
      }
      
      return {
        id: discountDetails.id || "",
        title: discountDetails.title || "Untitled Discount",
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
        discountType: discountType
      };
    }
    
    static extractFromWebhookPayload(payload: any): ExtractedDiscountData {
      // Fallback extraction from minimal webhook data
      return {
        id: payload.admin_graphql_api_id?.split('/').pop() || payload.id || "",
        title: payload.title || "Untitled Discount",
        code: "", // Webhook doesn't provide codes
        value: {
          displayValue: "Unknown"
        },
        type: "unknown",
        status: payload.status || "ACTIVE",
        startsAt: payload.created_at,
        endsAt: "",
        usageLimit: 0,
        discountType: "automatic" // Assume automatic from webhook
      };
    }
  }
  