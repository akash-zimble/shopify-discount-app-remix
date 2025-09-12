import { IConfigurationService, ValidationResult } from './interfaces/IValidationService';

/**
 * Configuration service implementation
 * Centralizes all configuration management and validation
 */
export class ConfigurationService implements IConfigurationService {
  private config: Record<string, any>;

  constructor() {
    this.config = this.loadConfiguration();
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfiguration(): Record<string, any> {
    return {
      // Shopify configuration
      shopify: {
        apiKey: process.env.SHOPIFY_API_KEY,
        apiSecret: process.env.SHOPIFY_API_SECRET,
        scopes: process.env.SCOPES?.split(',') || [],
        appUrl: process.env.SHOPIFY_APP_URL,
        customDomain: process.env.SHOP_CUSTOM_DOMAIN,
      },
      
      // Database configuration
      database: {
        url: process.env.DATABASE_URL || 'file:dev.sqlite',
      },
      
      // Application configuration
      app: {
        nodeEnv: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || 'info',
        maxProductsPerBatch: parseInt(process.env.MAX_PRODUCTS_PER_BATCH || '10'),
        rateLimitDelay: parseInt(process.env.RATE_LIMIT_DELAY || '500'),
        cronSecretToken: process.env.CRON_SECRET_TOKEN,
      },
      
      // Metafield configuration
      metafields: {
        namespace: 'discount_manager',
        key: 'active_discounts',
        type: 'json',
      } as { namespace: string; key: string; type: string },
    };
  }

  get<T>(key: string, defaultValue?: T): T {
    const keys = key.split('.');
    let value: any = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue as T;
      }
    }
    
    return value as T;
  }

  has(key: string): boolean {
    const keys = key.split('.');
    let value: any = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return false;
      }
    }
    
    return true;
  }

  getAll(): Record<string, any> {
    return { ...this.config };
  }

  validateRequired(keys: string[]): ValidationResult {
    const errors: string[] = [];
    
    for (const key of keys) {
      if (!this.has(key)) {
        errors.push(`Required configuration key '${key}' is missing`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate Shopify configuration
   */
  validateShopifyConfig(): ValidationResult {
    const requiredKeys = [
      'shopify.apiKey',
      'shopify.apiSecret',
      'shopify.appUrl',
    ];
    
    return this.validateRequired(requiredKeys);
  }

  /**
   * Get Shopify configuration
   */
  getShopifyConfig() {
    return this.get('shopify', {});
  }

  /**
   * Get metafield configuration
   */
  getMetafieldConfig() {
    return this.get('metafields', {});
  }

  /**
   * Get application configuration
   */
  getAppConfig() {
    return this.get('app', {});
  }
}

// Singleton instance
export const configurationService = new ConfigurationService();
