import { IValidationService, ValidationResult } from './interfaces/IValidationService';

/**
 * Validation service implementation
 * Provides comprehensive input validation for the application
 */
export class ValidationService implements IValidationService {
  
  validateDiscountId(discountId: string): ValidationResult {
    const errors: string[] = [];
    
    if (!discountId) {
      errors.push('Discount ID is required');
      return { isValid: false, errors };
    }
    
    if (typeof discountId !== 'string') {
      errors.push('Discount ID must be a string');
    }
    
    // Check if it's a valid Shopify GraphQL ID or numeric ID
    const isValidGraphQLId = discountId.startsWith('gid://shopify/');
    const isValidNumericId = /^\d+$/.test(discountId);
    const isValidPartialId = /^[a-zA-Z0-9_-]+$/.test(discountId);
    
    if (!isValidGraphQLId && !isValidNumericId && !isValidPartialId) {
      errors.push('Discount ID must be a valid Shopify GraphQL ID or numeric ID');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  validateProductId(productId: string): ValidationResult {
    const errors: string[] = [];
    
    if (!productId) {
      errors.push('Product ID is required');
      return { isValid: false, errors };
    }
    
    if (typeof productId !== 'string') {
      errors.push('Product ID must be a string');
    }
    
    // Check if it's a valid Shopify GraphQL ID
    const isValidGraphQLId = productId.startsWith('gid://shopify/Product/');
    const isValidNumericId = /^\d+$/.test(productId);
    
    if (!isValidGraphQLId && !isValidNumericId) {
      errors.push('Product ID must be a valid Shopify GraphQL ID or numeric ID');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  validateWebhookPayload(payload: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!payload) {
      errors.push('Webhook payload is required');
      return { isValid: false, errors };
    }
    
    if (typeof payload !== 'object') {
      errors.push('Webhook payload must be an object');
      return { isValid: false, errors };
    }
    
    // Check for required fields
    if (!payload.id && !payload.admin_graphql_api_id) {
      errors.push('Webhook payload must contain either id or admin_graphql_api_id');
    }
    
    if (!payload.title) {
      warnings.push('Webhook payload missing title field');
    }
    
    // Validate ID fields if present
    if (payload.id) {
      const idValidation = this.validateDiscountId(payload.id);
      if (!idValidation.isValid) {
        errors.push(...idValidation.errors.map(e => `payload.id: ${e}`));
      }
    }
    
    if (payload.admin_graphql_api_id) {
      const graphqlIdValidation = this.validateDiscountId(payload.admin_graphql_api_id);
      if (!graphqlIdValidation.isValid) {
        errors.push(...graphqlIdValidation.errors.map(e => `payload.admin_graphql_api_id: ${e}`));
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateDiscountData(data: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!data) {
      errors.push('Discount data is required');
      return { isValid: false, errors };
    }
    
    if (typeof data !== 'object') {
      errors.push('Discount data must be an object');
      return { isValid: false, errors };
    }
    
    // Check required fields
    if (!data.id) {
      errors.push('Discount data must contain an id field');
    } else {
      const idValidation = this.validateDiscountId(data.id);
      if (!idValidation.isValid) {
        errors.push(...idValidation.errors.map(e => `data.id: ${e}`));
      }
    }
    
    if (!data.title) {
      warnings.push('Discount data missing title field');
    }
    
    if (!data.status) {
      warnings.push('Discount data missing status field');
    } else if (!['ACTIVE', 'EXPIRED', 'DISABLED', 'SCHEDULED'].includes(data.status)) {
      warnings.push(`Unknown discount status: ${data.status}`);
    }
    
    if (!data.discountType) {
      warnings.push('Discount data missing discountType field');
    } else if (!['code', 'automatic'].includes(data.discountType)) {
      warnings.push(`Unknown discount type: ${data.discountType}`);
    }
    
    // Validate value object if present
    if (data.value && typeof data.value === 'object') {
      if (!data.value.displayValue) {
        warnings.push('Discount value missing displayValue');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateGraphQLResponse(response: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!response) {
      errors.push('GraphQL response is required');
      return { isValid: false, errors };
    }
    
    if (typeof response !== 'object') {
      errors.push('GraphQL response must be an object');
      return { isValid: false, errors };
    }
    
    // Check for GraphQL errors
    if (response.errors && Array.isArray(response.errors)) {
      errors.push(...response.errors.map((error: any) => 
        `GraphQL Error: ${error.message || 'Unknown error'}`
      ));
    }
    
    // Check for data field
    if (!response.data) {
      warnings.push('GraphQL response missing data field');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate array of product IDs
   */
  validateProductIds(productIds: string[]): ValidationResult {
    const errors: string[] = [];
    
    if (!Array.isArray(productIds)) {
      errors.push('Product IDs must be an array');
      return { isValid: false, errors };
    }
    
    if (productIds.length === 0) {
      errors.push('Product IDs array cannot be empty');
      return { isValid: false, errors };
    }
    
    for (let i = 0; i < productIds.length; i++) {
      const validation = this.validateProductId(productIds[i]);
      if (!validation.isValid) {
        errors.push(...validation.errors.map(e => `productIds[${i}]: ${e}`));
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate pagination parameters
   */
  validatePagination(page: number, limit: number): ValidationResult {
    const errors: string[] = [];
    
    if (typeof page !== 'number' || page < 1) {
      errors.push('Page must be a positive number');
    }
    
    if (typeof limit !== 'number' || limit < 1 || limit > 250) {
      errors.push('Limit must be a number between 1 and 250');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Singleton instance
export const validationService = new ValidationService();
