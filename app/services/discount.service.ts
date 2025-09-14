import { IDiscountService, InitializationResult } from './interfaces/IDiscountService';
import { IAdminClient } from './interfaces/IAdminClient';
import { IDiscountRepository } from './interfaces/IRepository';
import { IDiscountTargetingService } from './interfaces/IDiscountService';
import { IProductMetafieldService } from './interfaces/IDiscountService';
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
    private logger: Logger
  ) {}

  async processDiscountCreate(payload: any): Promise<ExtractedDiscountData> {
    try {
      // Validate webhook payload
      const payloadValidation = validationService.validateWebhookPayload(payload);
      if (!payloadValidation.isValid) {
        throw new Error(`Invalid webhook payload: ${payloadValidation.errors.join(', ')}`);
      }

      const rawDiscountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
      const discountId = normalizeDiscountId(rawDiscountId);

      if (!discountId) {
        throw new Error('No discount ID found in payload');
      }

      // Check if discount already exists
      const existingRule = await this.discountRepository.findByDiscountId(discountId);
      
      // Fetch full discount details
      const fullDiscountDetails = await this.fetchFullDiscountDetails(
        payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`
      );

      if (!fullDiscountDetails) {
        this.logger.warn('Could not fetch full discount details, using webhook payload', { discountId });
      }

      // Extract structured data
      const extractedData = fullDiscountDetails
        ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails.discount)
        : DiscountDataExtractor.extractFromWebhookPayload(payload);

      // Ensure we have a stable discount ID
      this.ensureStableDiscountId(extractedData, discountId, fullDiscountDetails);

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
        payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`,
        extractedData
      );

      return extractedData;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.processDiscountCreate' });
      throw error;
    }
  }

  async processDiscountUpdate(payload: any): Promise<ExtractedDiscountData> {
    try {
      // Validate webhook payload
      const payloadValidation = validationService.validateWebhookPayload(payload);
      if (!payloadValidation.isValid) {
        throw new Error(`Invalid webhook payload: ${payloadValidation.errors.join(', ')}`);
      }

      const rawDiscountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
      const discountId = normalizeDiscountId(rawDiscountId);

      if (!discountId) {
        throw new Error('No discount ID found in payload');
      }

      // Fetch full discount details
      const fullDiscountDetails = await this.fetchFullDiscountDetails(
        payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`
      );

      // Extract structured data
      const extractedData = fullDiscountDetails
        ? DiscountDataExtractor.extractFromFullDetails(fullDiscountDetails.discount)
        : DiscountDataExtractor.extractFromWebhookPayload(payload);

      // Ensure we have a stable discount ID
      this.ensureStableDiscountId(extractedData, discountId, fullDiscountDetails);

      // Get existing rule
      const existingRule = await this.discountRepository.findByDiscountId(discountId);

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
        payload.admin_graphql_api_id || `gid://shopify/DiscountNode/${discountId}`,
        extractedData
      );

      return extractedData;
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.processDiscountUpdate' });
      throw error;
    }
  }

  async processDiscountDelete(payload: any): Promise<{ id: string; deleted: boolean }> {
    try {
      // Validate webhook payload
      const payloadValidation = validationService.validateWebhookPayload(payload);
      if (!payloadValidation.isValid) {
        throw new Error(`Invalid webhook payload: ${payloadValidation.errors.join(', ')}`);
      }

      const rawDiscountId = payload.admin_graphql_api_id?.split('/').pop() || payload.id;
      const discountId = normalizeDiscountId(rawDiscountId);

      if (!discountId) {
        throw new Error('No discount ID found in payload');
      }

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
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.processDiscountDelete' });
      throw error;
    }
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
                          ... on DiscountAmount { __typename amount { amount currencyCode } }
                          ... on DiscountPercentage { __typename percentage }
                        }
                        items {
                          ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                          ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                          ... on AllDiscountItems { allItems }
                        }
                      }
                    }
                    ... on DiscountAutomaticBasic {
                      __typename
                      title
                      summary
                      status
                      startsAt
                      endsAt
                      customerGets {
                        value {
                          ... on DiscountAmount { __typename amount { amount currencyCode } }
                          ... on DiscountPercentage { __typename percentage }
                        }
                        items {
                          ... on DiscountProducts { products(first: 250) { edges { node { id } } } }
                          ... on DiscountCollections { collections(first: 250) { edges { node { id } } } }
                          ... on AllDiscountItems { allItems }
                        }
                      }
                    }
                    ... on DiscountAutomaticBxgy {
                      __typename
                      title
                      summary
                      status
                      startsAt
                      endsAt
                      customerGets {
                        value {
                          ... on DiscountAmount { __typename amount { amount currencyCode } }
                          ... on DiscountPercentage { __typename percentage }
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
                  ... on DiscountCodeBasic {
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
                    }
                  }
                  ... on DiscountAutomaticBasic {
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
                    }
                  }
                  ... on DiscountAutomaticBxgy {
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
                    }
                  }
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
        const result = await this.metafieldService.updateMultipleProductMetafields(affectedProducts, extractedData);
        
        // Update the products count in the database
        await this.discountRepository.updateProductsCount(extractedData.id, affectedProducts.length);

        this.logger.info('Updated product metafields', {
          updated: result.successCount,
          attempted: result.totalProcessed,
          discountId: extractedData.id,
        });

      }
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.updateAffectedProductMetafields' });
    }
  }

  private async removeFromProductMetafields(existingRule: any, discountId: string): Promise<void> {
    try {
      const affectedProducts = await this.targetingService.getAffectedProducts(discountId);
      const allProductIds = await this.targetingService.getAllProductIds();
      const productsToProcess = affectedProducts.length > 0 ? affectedProducts : allProductIds;

      if (productsToProcess.length > 0) {
        const result = await this.metafieldService.removeDiscountFromMultipleProducts(productsToProcess, discountId);
        
        this.logger.info('Removed discount from products', {
          removed: result.successCount,
          attempted: result.totalProcessed,
          discountId,
        });

      }
    } catch (error) {
      this.logger.error(error as Error, { scope: 'DiscountService.removeFromProductMetafields', discountId });
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
