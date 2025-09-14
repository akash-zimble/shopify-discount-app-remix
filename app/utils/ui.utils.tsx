import { Badge } from "@shopify/polaris";

/**
 * Shared UI utilities to reduce code duplication across components
 */

/**
 * Get status badge component with consistent styling
 */
export const getStatusBadge = (status: string) => {
  const normalizedStatus = status?.toUpperCase() || '';
  
  switch (normalizedStatus) {
    case 'ACTIVE':
      return <Badge tone="success">Active</Badge>;
    case 'EXPIRED':
      return <Badge tone="critical">Expired</Badge>;
    case 'DISABLED':
      return <Badge tone="critical">Disabled</Badge>;
    case 'INACTIVE':
      return <Badge tone="critical">Inactive</Badge>;
    case 'SCHEDULED':
      return <Badge tone="warning">Scheduled</Badge>;
    default:
      return <Badge tone="info">{status || 'Unknown'}</Badge>;
  }
};

/**
 * Get discount type badge component
 */
export const getDiscountTypeBadge = (type: string) => {
  const normalizedType = type?.toLowerCase() || '';
  
  switch (normalizedType) {
    case 'automatic':
      return <Badge tone="info">Automatic</Badge>;
    case 'code':
      return <Badge tone="success">Code</Badge>;
    default:
      return <Badge>{type || 'Unknown'}</Badge>;
  }
};

/**
 * Format date to locale string
 */
export const formatDate = (date: Date | string | null) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB');
};

/**
 * Format date and time to locale string
 */
export const formatDateTime = (date: Date | string | null) => {
  if (!date) return '-';
  return new Date(date).toLocaleString('en-GB');
};
