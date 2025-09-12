import { Logger, createLogger } from '../utils/logger.server';
import { IAdminClient } from './interfaces/IAdminClient';
import { IDiscountRepository } from './interfaces/IRepository';
import { IDiscountService, IDiscountTargetingService, IProductMetafieldService } from './interfaces/IDiscountService';
import { IValidationService, IConfigurationService } from './interfaces/IValidationService';

// Service implementations
import { AdminClientService } from './admin-client.service';
import { DiscountRepository } from './repositories/discount.repository';
import { DiscountService } from './discount.service';
import { DiscountTargetingService } from './discount-targeting.service';
import { ProductMetafieldService } from './product-metafield.service';
import { ValidationService } from './validation.service';
import { ConfigurationService } from './configuration.service';

/**
 * Service factory for creating and managing service instances
 * Implements dependency injection pattern
 */
export class ServiceFactory {
  private static instance: ServiceFactory;
  private services: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory();
    }
    return ServiceFactory.instance;
  }

  /**
   * Get or create a service instance
   */
  getService<T>(serviceName: string, factory: () => T): T {
    if (!this.services.has(serviceName)) {
      this.services.set(serviceName, factory());
    }
    return this.services.get(serviceName) as T;
  }

  /**
   * Create configuration service
   */
  createConfigurationService(): IConfigurationService {
    return this.getService('configuration', () => new ConfigurationService());
  }

  /**
   * Create validation service
   */
  createValidationService(): IValidationService {
    return this.getService('validation', () => new ValidationService());
  }

  /**
   * Create logger
   */
  createLogger(name: string): Logger {
    const config = this.createConfigurationService();
    const logLevel = config.get('app.logLevel', 'info');
    
    return this.getService(`logger-${name}`, () => {
      return createLogger({ name, level: logLevel as any });
    });
  }

  /**
   * Create admin client service
   */
  createAdminClientService(admin: any, logger: Logger): IAdminClient {
    return new AdminClientService(admin, logger);
  }

  /**
   * Create discount repository
   */
  createDiscountRepository(logger: Logger): IDiscountRepository {
    return new DiscountRepository(logger);
  }


  /**
   * Create discount targeting service
   */
  createDiscountTargetingService(adminClient: IAdminClient, logger: Logger): IDiscountTargetingService {
    return new DiscountTargetingService(adminClient, logger);
  }

  /**
   * Create product metafield service
   */
  createProductMetafieldService(adminClient: IAdminClient, logger: Logger): IProductMetafieldService {
    return new ProductMetafieldService(adminClient, logger);
  }

  /**
   * Create discount service with all dependencies
   */
  createDiscountService(
    adminClient: IAdminClient,
    discountRepository: IDiscountRepository,
    targetingService: IDiscountTargetingService,
    metafieldService: IProductMetafieldService,
    logger: Logger
  ): IDiscountService {
    return new DiscountService(
      adminClient,
      discountRepository,
      targetingService,
      metafieldService,
      logger
    );
  }

  /**
   * Create complete discount service stack
   */
  createDiscountServiceStack(admin: any, loggerName: string = 'discount-service'): {
    discountService: IDiscountService;
    adminClient: IAdminClient;
    discountRepository: IDiscountRepository;
    targetingService: IDiscountTargetingService;
    metafieldService: IProductMetafieldService;
    validationService: IValidationService;
    configurationService: IConfigurationService;
    logger: Logger;
  } {
    const logger = this.createLogger(loggerName);
    const configurationService = this.createConfigurationService();
    const validationService = this.createValidationService();
    
    const adminClient = this.createAdminClientService(admin, logger);
    const discountRepository = this.createDiscountRepository(logger);
    const targetingService = this.createDiscountTargetingService(adminClient, logger);
    const metafieldService = this.createProductMetafieldService(adminClient, logger);
    const discountService = this.createDiscountService(
      adminClient,
      discountRepository,
      targetingService,
      metafieldService,
      logger
    );

    return {
      discountService,
      adminClient,
      discountRepository,
      targetingService,
      metafieldService,
      validationService,
      configurationService,
      logger,
    };
  }

  /**
   * Clear all cached services (useful for testing)
   */
  clearServices(): void {
    this.services.clear();
  }

  /**
   * Get service statistics
   */
  getServiceStats(): { totalServices: number; serviceNames: string[] } {
    return {
      totalServices: this.services.size,
      serviceNames: Array.from(this.services.keys()),
    };
  }
}

// Export singleton instance
export const serviceFactory = ServiceFactory.getInstance();

/**
 * Convenience function to create discount service stack
 */
export function createDiscountServiceStack(admin: any, loggerName?: string) {
  return serviceFactory.createDiscountServiceStack(admin, loggerName);
}

/**
 * Convenience function to create logger
 */
export function createServiceLogger(name: string): Logger {
  return serviceFactory.createLogger(name);
}
