import { Logger, createLogger } from '../utils/logger.server';
import { IAdminClient } from './interfaces/IAdminClient';
import { IDiscountRepository, IProductDiscountRepository } from './interfaces/IRepository';
import { IDiscountService, IDiscountTargetingService, IProductMetafieldService, IProductService, IProductDiscountService } from './interfaces/IDiscountService';
import { ProductDiscount, ProductDiscountInput, ProductDiscountWithDetails } from '../types/product-discount.types';
import { IValidationService, IConfigurationService } from './interfaces/IValidationService';

// Service implementations
import { AdminClientService } from './admin-client.service';
import { DiscountRepository } from './repositories/discount.repository';
import { ProductDiscountRepository } from './repositories/product-discount.repository';
import { DiscountService } from './discount.service';
import { ProductDiscountService } from './product-discount.service';
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
  productDiscountService: IProductDiscountService;
  adminClient: IAdminClient;
  discountRepository: IDiscountRepository;
  productDiscountRepository: IProductDiscountRepository;
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
  const productDiscountRepository = new ProductDiscountRepository(logger, shop);
  const targetingService = new DiscountTargetingService(adminClient, logger);
  const metafieldService = new ProductMetafieldService(adminClient, logger);
  const productService = new ProductService(adminClient, logger, shop || 'unknown');
  
  // Create ProductDiscountService first (it doesn't depend on DiscountService)
  const productDiscountService = new ProductDiscountService(
    productDiscountRepository,
    productService,
    null as any, // We'll set this after creating DiscountService
    logger,
    shop || 'unknown'
  );
  
  // Create DiscountService with ProductDiscountService
  const discountService = new DiscountService(
    adminClient,
    discountRepository,
    targetingService,
    metafieldService,
    productDiscountService,
    productService,
    logger
  );
  
  // Now set the DiscountService reference in ProductDiscountService
  (productDiscountService as any).discountService = discountService;

  return {
    discountService,
    productDiscountService,
    adminClient,
    discountRepository,
    productDiscountRepository,
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
