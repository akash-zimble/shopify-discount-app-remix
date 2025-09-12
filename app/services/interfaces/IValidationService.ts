/**
 * Validation service interface for input validation
 */
export interface IValidationService {
  /**
   * Validate discount ID format
   */
  validateDiscountId(discountId: string): ValidationResult;
  
  /**
   * Validate product ID format
   */
  validateProductId(productId: string): ValidationResult;
  
  /**
   * Validate webhook payload structure
   */
  validateWebhookPayload(payload: any): ValidationResult;
  
  /**
   * Validate discount data structure
   */
  validateDiscountData(data: any): ValidationResult;
  
  /**
   * Validate GraphQL response
   */
  validateGraphQLResponse(response: any): ValidationResult;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Configuration service interface
 */
export interface IConfigurationService {
  /**
   * Get configuration value
   */
  get<T>(key: string, defaultValue?: T): T;
  
  /**
   * Check if configuration key exists
   */
  has(key: string): boolean;
  
  /**
   * Get all configuration
   */
  getAll(): Record<string, any>;
  
  /**
   * Validate required configuration
   */
  validateRequired(keys: string[]): ValidationResult;
}
