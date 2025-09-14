import { Logger, createLogger } from '../utils/logger.server';
import { IAdminClient } from './interfaces/IAdminClient';
import { IDiscountRepository } from './interfaces/IRepository';
import { IDiscountService, IDiscountTargetingService, IProductMetafieldService, IProductService } from './interfaces/IDiscountService';
import { IValidationService, IConfigurationService } from './interfaces/IValidationService';

// Service implementations
import { AdminClientService } from './admin-client.service';
import { DiscountRepository } from './repositories/discount.repository';
import { DiscountService } from './discount.service';
import { DiscountTargetingService } from './discount-targeting.service';
import { ProductMetafieldService } from './product-metafield.service';
import { ProductService } from './product.service';
import { ValidationService } from './validation.service';
import { ConfigurationService } from './configuration.service';


const configurationService = new ConfigurationService();
const validationService = new ValidationService();


export function createServiceLogger(name: string): Logger {
  const logLevel = configurationService.get('app.logLevel', 'info');
  return createLogger({ name, level: logLevel as any });
}

export function createDiscountServiceStack(admin: any, loggerName: string = 'discount-service', shop?: string): {
  discountService: IDiscountService;
  adminClient: IAdminClient;
  discountRepository: IDiscountRepository;
  targetingService: IDiscountTargetingService;
  metafieldService: IProductMetafieldService;
  productService: IProductService;
  validationService: IValidationService;
  configurationService: IConfigurationService;
  logger: Logger;
} {
  const logger = createServiceLogger(loggerName);
  
  // Create services with proper dependency injection
  const adminClient = new AdminClientService(admin, logger);
  const discountRepository = new DiscountRepository(logger, shop);
  const targetingService = new DiscountTargetingService(adminClient, logger);
  const metafieldService = new ProductMetafieldService(adminClient, logger);
  const productService = new ProductService(adminClient, logger, shop || 'unknown');
  const discountService = new DiscountService(
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
    productService,
    validationService,
    configurationService,
    logger,
  };
}

export function createServiceStack(admin: any, loggerName: string = 'service', shop?: string): {
  productService: IProductService;
  adminClient: IAdminClient;
  validationService: IValidationService;
  configurationService: IConfigurationService;
  logger: Logger;
} {
  const logger = createServiceLogger(loggerName);
  
  // Create services with proper dependency injection
  const adminClient = new AdminClientService(admin, logger);
  const productService = new ProductService(adminClient, logger, shop || 'unknown');

  return {
    productService,
    adminClient,
    validationService,
    configurationService,
    logger,
  };
}
