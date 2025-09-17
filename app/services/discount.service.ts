import { IDiscountService, InitializationResult, IProductService } from './interfaces/IDiscountService';
import { IAdminClient } from './interfaces/IAdminClient';
import { IDiscountRepository } from './interfaces/IRepository';
import { IDiscountTargetingService } from './interfaces/IDiscountService';
import { IProductMetafieldService } from './interfaces/IDiscountService';
import { IProductDiscountService } from './interfaces/IDiscountService';
import { Logger } from '../utils/logger.server';
import { validationService } from './validation.service';
import { DiscountDataExtractor, normalizeDiscountId, ExtractedDiscountData } from './discountDataExtractor.server';
import { configurationService } from './configuration.service';

/**
 * Discount service implementation
 * Orchestrates discount-related operations following SOLID principles
 */
export class DiscountService implements IDiscountService {
  constructor(
    private adminClient: IAdminClient,
    private discountRepository: IDiscountRepository,
    private targetingService: IDiscountTargetingService,
    private metafieldService: IProductMetafieldService,
    private productDiscountService: IProductDiscountService,
    private productService: IProductService,
    private logger: Logger
  ) {}

  // Common GraphQL fragments to eliminate duplication
  private readonly DISCOUNT_FRAGMENTS = {
    customerGets: `
      customerGets {
        value {
          __typename
          ... on DiscountAmount { 
            amount { 
              amount 
              currencyCode 
            } 
          }
          ... on DiscountPercentage { 
            percentage 
          }
        }
        items {
          ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
          ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
          ... on AllDiscountItems { allItems }
        }
      }
    `,
    discountCodeBasic: `
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
            __typename
            ... on DiscountAmount { 
              amount { 
                amount 
                currencyCode 
              } 
            }
            ... on DiscountPercentage { 
              percentage 
            }
          }
          items {
            ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
            ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
            ... on AllDiscountItems { allItems }
          }
        }
      }
    `,
    discountAutomaticBasic: `
      ... on DiscountAutomaticBasic {
        __typename
        title
        summary
        status
        startsAt
        endsAt
        customerGets {
          value {
            __typename
            ... on DiscountAmount { 
              amount { 
                amount 
                currencyCode 
              } 
            }
            ... on DiscountPercentage { 
              percentage 
            }
          }
          items {
            ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
            ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
            ... on AllDiscountItems { allItems }
          }
        }
      }
    `,
    discountAutomaticBxgy: `
      ... on DiscountAutomaticBxgy {
        __typename
        title
        summary
        status
        startsAt
        endsAt
        customerGets {
          value {
            __typename
            ... on DiscountAmount { 
              amount { 
                amount 
                currencyCode 
              } 
            }
            ... on DiscountPercentage { 
              percentage 
            }
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
    `
  };

  // Common helper methods to eliminate duplication
  private async validateAndExtractDiscountId(payload: any): Promise<string> {
    const payloadValidation = validationService.validateWebhookPayload(payload);
    if (!payloadValidation.isValid) {
      throw new Error(`Invalid webhook payload: ${payloadValidation.errors.join(', ')}`);
    }

    const rawDiscountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
    const discountId = normalizeDiscountId(rawDiscountId);

    if (!discountId) {
      throw new Error('No discount ID found in payload');
    }

    return discountId;
  }

  private async processDiscountWithErrorHandling<T>(
    operation: () => Promise<T>,
    scope: string,
    context?: Record<string, any>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(error as Error, { scope, ...context });
      throw error;
    }
  }

  private buildDiscountGraphqlId(discountId: string, payload?: any): string {
    return payload?.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`;
  }

  private async processDiscountData(
    payload: any,
    discountId: string,
    operation: 'create' | 'update'
  ): Promise<{ extractedData: ExtractedDiscountData; existingRule: any; fullDiscountDetails: any }> {
    const graphqlId = this.buildDiscountGraphqlId(discountId, payload);
    
    // Fetch full discount details
    const fullDiscountDetails = await this.fetchFullDiscountDetails(graphqlId);

    if (!fullDiscountDetails && operation === 'create') {
      this.logger.warn('Could not fetch full discount details, using webhook payload', { discountId });
    }

    // Extract structured data
    const extractedData = fullDiscountDetails
      ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails.discount)
      : DiscountDataExtractor.extractFromWebhookPayload(payload);

    // Ensure we have a stable discount ID
    this.ensureStableDiscountId(extractedData, discountId, fullDiscountDetails);

    // Get existing rule
    const existingRule = await this.discountRepository.findByDiscountId(discountId);

    return { extractedData, existingRule, fullDiscountDetails };
  }

  async processDiscountCreate(payload: any): Promise<ExtractedDiscountData> {
    return this.processDiscountWithErrorHandling(async () => {
      const discountId = await this.validateAndExtractDiscountId(payload);
      const { extractedData, existingRule } = await this.processDiscountData(payload, discountId, 'create');

      // Only process ACTIVE discounts
      if (extractedData.status !== 'ACTIVE') {
        this.logger.info('Discount created but not ACTIVE - skipping metafield updates', {
          discountId,
          status: extractedData.status,
        });
        
        await this.createOrUpdateInactiveDiscount(discountId, extractedData);
        return extractedData;
      }

      // Create or update the discount rule
      await this.createOrUpdateDiscountRule(discountId, extractedData, existingRule);

      // Update product metafields
      await this.updateAffectedProductMetafields(
        this.buildDiscountGraphqlId(discountId, payload),
        extractedData
      );

      return extractedData;
    }, 'DiscountService.processDiscountCreate');
  }

  async processDiscountUpdate(payload: any): Promise<ExtractedDiscountData> {
    return this.processDiscountWithErrorHandling(async () => {
      const discountId = await this.validateAndExtractDiscountId(payload);
      const { extractedData, existingRule } = await this.processDiscountData(payload, discountId, 'update');

      // If not ACTIVE, treat as removal
      if (extractedData.status !== 'ACTIVE') {
        this.logger.info('Discount updated but not ACTIVE - treating as removal', {
          discountId,
          status: extractedData.status,
        });

        if (existingRule) {
          await this.discountRepository.updateByDiscountId(discountId, {
            metafieldValue: JSON.stringify(extractedData),
            isActive: false,
            status: extractedData.status || 'EXPIRED',
          });
          await this.removeFromProductMetafields(existingRule, discountId);
        }
        return extractedData;
      }

      // Update the discount rule
      await this.createOrUpdateDiscountRule(discountId, extractedData, existingRule);

      // Update product metafields
      await this.updateAffectedProductMetafields(
        this.buildDiscountGraphqlId(discountId, payload),
        extractedData
      );

      return extractedData;
    }, 'DiscountService.processDiscountUpdate');
  }

  async processDiscountDelete(payload: any): Promise<{ id: string; deleted: boolean }> {
    return this.processDiscountWithErrorHandling(async () => {
      const discountId = await this.validateAndExtractDiscountId(payload);

      // Get existing rule before deactivating
      const existingRule = await this.discountRepository.findByDiscountId(discountId);

      // Deactivate rule
      await this.discountRepository.deactivateByDiscountId(discountId);

      this.logger.info('Deactivated metafield rule for deleted discount', { discountId });

      // Remove from product metafields
      if (existingRule) {
        await this.removeFromProductMetafields(existingRule, discountId);
      }

      return { id: discountId, deleted: true };
    }, 'DiscountService.processDiscountDelete');
  }

  async initializeAllDiscounts(): Promise<InitializationResult> {
    this.logger.info('Starting initialization of all existing discounts');

    try {
      // Fetch all discounts from Shopify
      const allDiscounts = await this.getAllDiscountsFromShopify();
      this.logger.info(`Found ${allDiscounts.length} discounts in Shopify`);

      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const discount of allDiscounts) {
        this.logger.debug('Processing discount', { 
          discountId: discount.id, 
          title: discount.title,
          fullDiscount: discount 
        });
        
        const normalizedId = normalizeDiscountId(discount.id);

        try {
          // Check if we already have this discount
          const existingRule = await this.discountRepository.findByDiscountId(normalizedId);

          if (existingRule) {
            this.logger.debug(`Skipping existing discount: ${discount.title} (${normalizedId})`);
            skippedCount++;
            continue;
          }

          // Only process ACTIVE discounts
          if (discount.status !== 'ACTIVE') {
            this.logger.debug(`Skipping inactive discount: ${discount.title} (${normalizedId}) - Status: ${discount.status}`);
            skippedCount++;
            continue;
          }

          // Validate that we can get targeting information for this discount
          // This prevents processing discounts that can't be properly queried
          try {
            const targeting = await this.targetingService.getDiscountTargeting(discount.id);
            
            // Check if this discount couldn't be found with any node type
            if (targeting.notFound) {
              this.logger.warn(`Skipping discount that cannot be queried: ${discount.title} (${normalizedId})`);
              skippedCount++;
              continue;
            }
          } catch (targetingError) {
            this.logger.warn(`Skipping discount due to targeting validation failure: ${discount.title} (${normalizedId})`, {
              error: targetingError instanceof Error ? targetingError.message : String(targetingError)
            });
            skippedCount++;
            continue;
          }

          // Create database record
          await this.discountRepository.create({
            discountId: normalizedId,
            discountType: discount.discountType,
            discountTitle: discount.title,
            metafieldNamespace: 'discount_manager',
            metafieldKey: 'active_discounts',
            metafieldValue: JSON.stringify(discount),
            isActive: true,
            discountValue: discount.value?.displayValue || null,
            discountValueType: discount.type || null,
            status: discount.status || 'ACTIVE',
            startDate: discount.startsAt ? new Date(discount.startsAt) : null,
            endDate: discount.endsAt ? new Date(discount.endsAt) : null,
            productsCount: 0,
          });

          // Update product metafields
          await this.updateAffectedProductMetafields(discount.id, discount);

          processedCount++;
          this.logger.info(`Processed discount: ${discount.title} (${normalizedId})`);

          // Rate limiting
          const rateLimitDelay = configurationService.get('app.rateLimitDelay', 1000);
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay));

        } catch (error) {
          this.logger.error(error as Error, {
            scope: 'DiscountService.initializeAllDiscounts.discount',
            discountId: normalizedId,
            discountTitle: discount.title,
          });
          errorCount++;
        }
      }

      this.logger.info('Initialization completed', {
        totalFound: allDiscounts.length,
        processed: processedCount,
        skipped: skippedCount,
        errors: errorCount,
      });

      return {
        success: true,
        totalFound: allDiscounts.length,
        processed: processedCount,
        skipped: skippedCount,
        errors: errorCount,
      };
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.initializeAllDiscounts.root' });
      return {
        success: false,
        totalFound: 0,
        processed: 0,
        skipped: 0,
        errors: 0,
        error: String(error),
      };
    }
  }

  async getAllDiscountsFromShopify(): Promise<ExtractedDiscountData[]> {
    const allDiscounts: ExtractedDiscountData[] = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      try {
        const response: any = await this.adminClient.executeQuery(`
          query getAllDiscounts($first: Int!, $after: String) {
            discountNodes(first: $first, after: $after) {
              edges {
                node {
                  id
                  discount {
                    __typename
                    ${this.DISCOUNT_FRAGMENTS.discountCodeBasic}
                    ${this.DISCOUNT_FRAGMENTS.discountAutomaticBasic}
                    ${this.DISCOUNT_FRAGMENTS.discountAutomaticBxgy}
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `, {
          variables: { first: 50, after: cursor },
        });

        const edges = response.data?.discountNodes?.edges || [];
        const pageInfo = response.data?.discountNodes?.pageInfo as any;

        for (const edge of edges) {
          if (edge.node?.discount) {
            const extractedData = DiscountDataExtractor.extractFromFullDetails(edge.node.discount);
            // Set the ID from the node level and normalize it
            extractedData.id = normalizeDiscountId(edge.node.id);
            allDiscounts.push(extractedData);
          }
        }

        hasNextPage = pageInfo?.hasNextPage || false;
        cursor = pageInfo?.endCursor || null;

        // Rate limiting between pages
        if (hasNextPage) {
          const rateLimitDelay = configurationService.get('app.rateLimitDelay', 500);
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        }
      } catch (error) {
        this.logger.error(error as Error, { scope: 'DiscountService.getAllDiscountsFromShopify.page' });
        break;
      }
    }

    return allDiscounts;
  }


  private async fetchFullDiscountDetails(discountGraphqlId: string): Promise<any> {
    try {
      const candidates = this.buildDiscountIdCandidates(discountGraphqlId);

      // Try generic node(id: ...) with the provided/admin id
      for (const id of candidates) {
        try {
          // Use the correct DiscountNode query structure with value information
          const response = await this.adminClient.executeQuery(`
            query getDiscountNode($id: ID!) {
              discountNode(id: $id) {
                id
                discount {
                  __typename
                  ${this.DISCOUNT_FRAGMENTS.discountCodeBasic}
                  ${this.DISCOUNT_FRAGMENTS.discountAutomaticBasic}
                  ${this.DISCOUNT_FRAGMENTS.discountAutomaticBxgy}
                }
              }
            }
          `, { variables: { id } });

          const discountNode = response.data?.discountNode;
          const discount = discountNode?.discount;
          const typename = discount?.__typename;
          
          if (typename === 'DiscountCodeBasic' || typename === 'DiscountAutomaticBasic' || typename === 'DiscountAutomaticBxgy') {
            this.logger.debug('Fetched discount via discountNode()', { id, typename });
            return { nodeId: discountNode.id, discount: discount };
          }
        } catch (error) {
          // Continue to next candidate
          continue;
        }
      }

      this.logger.warn('Failed to fetch full discount details with candidates', { candidates });
      return null;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.fetchFullDiscountDetails', discountGraphqlId });
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
      `gid://shopify/DiscountNode/${coreId}`,
    ];
    const set = new Set<string>(candidates);
    set.add(inputId);
    return Array.from(set);
  }

  private ensureStableDiscountId(extractedData: ExtractedDiscountData, discountId: string, fullDetails: any): void {
    const originalExtractedId = extractedData.id;
    const fallbackNumericId = String(discountId || '').trim();
    
    // Extract ID from the new GraphQL response structure
    const nodeIdTail = fullDetails?.nodeId ? String(fullDetails.nodeId).split('/').pop() : '';

    if (!originalExtractedId || originalExtractedId.length === 0) {
      // Try to get ID from discount node first, then fallback to other sources
      const rawId = nodeIdTail || fallbackNumericId;
      // Normalize the ID to ensure consistency with database storage
      extractedData.id = normalizeDiscountId(rawId);
      
      if (extractedData.id !== fallbackNumericId) {
        this.logger.warn('Missing discount ID in extracted data - applied fallback', {
          originalExtractedId,
          nodeIdTail,
          fallbackNumericId,
          finalId: extractedData.id,
        });
      }
    } else {
      // Normalize the existing ID to ensure consistency
      extractedData.id = normalizeDiscountId(extractedData.id);
    }

    if (!extractedData.id) {
      this.logger.error('Discount ID is still empty after fallback', {
        discountId,
        nodeId: fullDetails?.nodeId,
      });
    }
  }

  private async createOrUpdateInactiveDiscount(discountId: string, extractedData: ExtractedDiscountData): Promise<void> {
    const existingRule = await this.discountRepository.findByDiscountId(discountId);
    
    if (existingRule) {
      await this.discountRepository.updateByDiscountId(discountId, {
        isActive: false,
        lastRan: new Date(),
      });
    } else {
      await this.discountRepository.create({
        discountId,
        discountType: extractedData.discountType,
        discountTitle: extractedData.title,
        metafieldNamespace: 'discount_manager',
        metafieldKey: 'active_discounts',
        metafieldValue: JSON.stringify(extractedData),
        isActive: false,
        lastRan: new Date(),
        discountValue: extractedData.value?.displayValue || null,
        discountValueType: extractedData.type || null,
        status: extractedData.status || 'ACTIVE',
        startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
        endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null,
        productsCount: 0,
      });
    }
  }

  private async createOrUpdateDiscountRule(
    discountId: string,
    extractedData: ExtractedDiscountData,
    existingRule: any
  ): Promise<void> {
    const ruleData = {
      discountTitle: extractedData.title,
      metafieldValue: JSON.stringify(extractedData),
      isActive: true,
      lastRan: new Date(),
      discountValue: extractedData.value?.displayValue || null,
      discountValueType: extractedData.type || null,
      status: extractedData.status || 'ACTIVE',
      startDate: extractedData.startsAt ? new Date(extractedData.startsAt) : null,
      endDate: extractedData.endsAt ? new Date(extractedData.endsAt) : null,
    };

    if (existingRule) {
      await this.discountRepository.updateByDiscountId(discountId, ruleData);
      this.logger.info('Updated existing metafield rule', { discountId });
    } else {
      await this.discountRepository.create({
        discountId,
        discountType: extractedData.discountType,
        metafieldNamespace: 'discount_manager',
        metafieldKey: 'active_discounts',
        productsCount: 0,
        ...ruleData,
      });
      this.logger.info('Created metafield rule', { discountId });
    }
  }

  private async updateAffectedProductMetafields(discountGraphqlId: string, extractedData: ExtractedDiscountData): Promise<void> {
    try {
      const affectedProducts = await this.targetingService.getAffectedProducts(discountGraphqlId);
      this.logger.info('Found affected products', { discountGraphqlId, count: affectedProducts.length });

      if (affectedProducts.length > 0) {
        // Update product metafields (existing functionality)
        const result = await this.metafieldService.updateMultipleProductMetafields(affectedProducts, extractedData);
        
        // Update the products count in the database
        await this.discountRepository.updateProductsCount(extractedData.id, affectedProducts.length);

        // NEW: Create ProductDiscount relationships
        await this.createProductDiscountRelationships(affectedProducts, extractedData);

        this.logger.info('Updated product metafields and relationships', {
          updated: result.successCount,
          attempted: result.totalProcessed,
          discountId: extractedData.id,
        });

      }
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.updateAffectedProductMetafields' });
    }
  }

  async removeFromProductMetafields(existingRule: any, discountId: string): Promise<void> {
    try {
      // First, get the discount rule to get the internal ID
      const discountRule = await this.discountRepository.findByDiscountId(discountId);
      if (!discountRule) {
        this.logger.warn('Discount rule not found in database', { discountId });
        return;
      }

      // Get products that have ProductDiscount relationships with this discount
      const productDiscountRelationships = await this.productDiscountService.getDiscountProducts(discountRule.id);
      
      this.logger.info('Found ProductDiscount relationships for discount', { 
        discountId, 
        discountRuleId: discountRule.id, 
        relationshipsCount: productDiscountRelationships.length 
      });
      
      if (productDiscountRelationships.length === 0) {
        this.logger.info('No ProductDiscount relationships found for discount', { discountId, discountRuleId: discountRule.id });
        return;
      }

      // Convert internal product IDs to Shopify product GIDs
      const shopifyProductIds = [];
      for (const relationship of productDiscountRelationships) {
        try {
          const product = await this.productService.getProductByInternalId(relationship.productId);
          if (product) {
            shopifyProductIds.push(`gid://shopify/Product/${product.shopifyId}`);
          }
        } catch (error) {
          this.logger.error(error as Error, { 
            scope: 'DiscountService.removeFromProductMetafields.productLookup',
            productId: relationship.productId 
          });
        }
      }

      this.logger.info('Converted ProductDiscount relationships to Shopify product IDs', { 
        discountId, 
        relationshipsCount: productDiscountRelationships.length,
        shopifyProductIdsCount: shopifyProductIds.length,
        shopifyProductIds: shopifyProductIds
      });

      if (shopifyProductIds.length > 0) {
        // Remove from product metafields (only for products with relationships)
        const result = await this.metafieldService.removeDiscountFromMultipleProducts(shopifyProductIds, discountId);
        
        // Remove ProductDiscount relationships
        await this.removeProductDiscountRelationships(discountId);
        
        this.logger.info('Removed discount from products and relationships', {
          removed: result.successCount,
          attempted: result.totalProcessed,
          discountId,
          relationshipsFound: productDiscountRelationships.length,
          productsProcessed: shopifyProductIds.length
        });
      }
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.removeFromProductMetafields', discountId });
    }
  }

  /**
   * Create ProductDiscount relationships for affected products
   */
  private async createProductDiscountRelationships(affectedProducts: string[], extractedData: ExtractedDiscountData): Promise<void> {
    try {
      // Get the discount rule from database to get the internal ID
      const discountRule = await this.discountRepository.findByDiscountId(extractedData.id);
      if (!discountRule) {
        this.logger.warn('Discount rule not found in database', { discountId: extractedData.id });
        return;
      }

      // Get existing ProductDiscount relationships for this discount
      const existingRelationships = await this.productDiscountService.getDiscountProducts(discountRule.id);

      if (existingRelationships.length > 0) {
        // Case 1: Existing discount - reactivate existing relationships
        const productRelationships = existingRelationships.map(rel => ({
          productId: rel.productId,
          discountId: rel.discountId,
          isActive: true
        }));
        
        const result = await this.productDiscountService.createBulkRelationships(productRelationships);
        
        this.logger.info('Reactivated ProductDiscount relationships', {
          discountId: extractedData.id,
          discountRuleId: discountRule.id,
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors
        });
      } else {
        // Case 2: New discount - create new relationships from affected products
        const productRelationships = [];
        for (const shopifyProductId of affectedProducts) {
          try {
            const numericId = shopifyProductId.replace('gid://shopify/Product/', '');
            const product = await this.productService.getProductById(numericId);
            if (product) {
              productRelationships.push({
                productId: product.id,
                discountId: discountRule.id,
                isActive: true
              });
            }
          } catch (error) {
            this.logger.error(error as Error, { 
              scope: 'DiscountService.createProductDiscountRelationships.productLookup',
              shopifyProductId 
            });
          }
        }

        if (productRelationships.length > 0) {
          const result = await this.productDiscountService.createBulkRelationships(productRelationships);
          
          this.logger.info('Created new ProductDiscount relationships', {
            discountId: extractedData.id,
            discountRuleId: discountRule.id,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            errors: result.errors
          });
        }
      }
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'DiscountService.createProductDiscountRelationships',
        discountId: extractedData.id 
      });
    }
  }

  /**
   * Remove ProductDiscount relationships for affected products
   */
  private async removeProductDiscountRelationships(discountId: string): Promise<void> {
    try {
      // Get the discount rule from database to get the internal ID
      const discountRule = await this.discountRepository.findByDiscountId(discountId);
      if (!discountRule) {
        this.logger.warn('Discount rule not found in database', { discountId });
        return;
      }

      // Get existing ProductDiscount relationships for this discount
      const existingRelationships = await this.productDiscountService.getDiscountProducts(discountRule.id);

      if (existingRelationships.length > 0) {
        // Convert to the format expected by removeBulkRelationships
        const productRelationships = existingRelationships.map(rel => ({
          productId: rel.productId,
          discountId: rel.discountId
        }));
        
        // Remove relationships in bulk
        const result = await this.productDiscountService.removeBulkRelationships(productRelationships);
        
        this.logger.info('Deactivated ProductDiscount relationships', {
          discountId,
          discountRuleId: discountRule.id,
          deactivated: result.updated,
          skipped: result.skipped,
          errors: result.errors
        });
      }
    } catch (error) {
      this.logger.error(error as Error, { 
        scope: 'DiscountService.removeProductDiscountRelationships',
        discountId 
      });
    }
  }


  /**
   * Get a specific discount from Shopify by ID
   */
  async getDiscountFromShopify(discountId: string): Promise<ExtractedDiscountData | null> {
    try {
      this.logger.info('Fetching specific discount from Shopify', { discountId });

      // Normalize the discount ID to ensure it's in the correct format
      const normalizedId = normalizeDiscountId(discountId);
      if (!normalizedId) {
        this.logger.error('Invalid discount ID format', { discountId });
        return null;
      }

      // Build the GraphQL ID
      const graphqlId = normalizedId.startsWith('gid://') ? normalizedId : `gid://shopify/DiscountNode/${normalizedId}`;

      // Fetch the discount details
      const fullDiscountDetails = await this.fetchFullDiscountDetails(graphqlId);
      
      if (!fullDiscountDetails?.discount) {
        this.logger.warn('Discount not found in Shopify', { discountId, graphqlId });
        return null;
      }

      // Extract structured data from the full details
      const extractedData = DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails.discount);
      
      // Ensure we have a stable discount ID
      this.ensureStableDiscountId(extractedData, normalizedId, fullDiscountDetails);

      this.logger.info('Successfully fetched discount from Shopify', {
        discountId: extractedData.id,
        title: extractedData.title,
        status: extractedData.status,
      });

      return extractedData;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'DiscountService.getDiscountFromShopify',
        discountId,
      });
      return null;
    }
  }

}
