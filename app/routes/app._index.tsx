import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, Link, useNavigate } from "@remix-run/react";
import type { SerializeFrom } from "@remix-run/node";
import { Page, Layout, Text, Card, Button, BlockStack, DataTable, Badge, InlineStack, EmptyState, Spinner, Toast, Frame, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createDiscountServiceStack, createServiceLogger } from "../services/service-factory";
import { ErrorHandlingService, AppError } from "../services/error-handling.service";
import { validationService } from "../services/validation.service";
import { getStatusBadge, formatDate, formatDateTime } from "../utils/ui.utils";
import { ProductDiscountSummary } from "../types/product-discount.types";

/**
 * Optimized route handler following SOLID principles
 * Separates concerns and uses dependency injection
 */

/**
 * Helper function to create ProductDiscount relationships for refresh action
 */
async function createProductDiscountRelationshipsForRefresh(
  affectedProducts: string[], 
  discountData: any, 
  productDiscountService: any, 
  discountRepository: any,
  productService: any,
  logger: any
): Promise<void> {
  try {
    // Get the discount rule from database to get the internal ID
    const discountRule = await discountRepository.findByDiscountId(discountData.id);
    if (!discountRule) {
      logger.warn('Discount rule not found in database', { discountId: discountData.id });
      return;
    }

    // Convert Shopify product IDs to internal product IDs
    const productRelationships = [];
    for (const shopifyProductId of affectedProducts) {
      try {
        // Extract numeric ID from Shopify GID format
        const numericId = shopifyProductId.replace('gid://shopify/Product/', '');
        
        // Find the product in our database using Shopify ID
        logger.info('Looking for product in database', { 
          shopifyProductId, 
          numericId, 
          shop: productService.shop 
        });
        
        const product = await productService.getProductById(numericId);
        if (product) {
          logger.info('Found product in database', { 
            shopifyProductId, 
            numericId, 
            internalId: product.id,
            productTitle: product.title 
          });
          productRelationships.push({
            productId: product.id,
            discountId: discountRule.id,
            isActive: true
          });
        } else {
          logger.warn('Product not found in database', { shopifyProductId, numericId });
        }
      } catch (error) {
        logger.error(error as Error, { 
          scope: 'createProductDiscountRelationshipsForRefresh.productLookup',
          shopifyProductId 
        });
      }
    }

    if (productRelationships.length > 0) {
      logger.info('Attempting to create ProductDiscount relationships', {
        discountId: discountData.id,
        discountRuleId: discountRule.id,
        productRelationships: productRelationships
      });
      
      // Create relationships in bulk
      const result = await productDiscountService.createBulkRelationships(productRelationships);
      
      logger.info('Created ProductDiscount relationships for refresh', {
        discountId: discountData.id,
        discountRuleId: discountRule.id,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
        errorDetails: result.errorDetails
      });
    }
  } catch (error) {
    logger.error(error as Error, { 
      scope: 'createProductDiscountRelationshipsForRefresh',
      discountId: discountData.id 
    });
    throw error;
  }
}

/**
 * Helper function to remove ProductDiscount relationships for inactive discount
 */
async function removeProductDiscountRelationshipsForRefresh(
  discountId: string, 
  productDiscountService: any, 
  discountRepository: any,
  logger: any
): Promise<void> {
  try {
    // Get the discount rule from database to get the internal ID
    const discountRule = await discountRepository.findByDiscountId(discountId);
    if (!discountRule) {
      logger.warn('Discount rule not found in database', { discountId });
      return;
    }

    // Remove all relationships for this discount
    const removedCount = await productDiscountService.deactivateDiscountProducts(discountRule.id);
    
    logger.info('Removed ProductDiscount relationships for inactive discount', {
      discountId,
      discountRuleId: discountRule.id,
      removedCount
    });
  } catch (error) {
    logger.error(error as Error, { 
      scope: 'removeProductDiscountRelationshipsForRefresh',
      discountId 
    });
    throw error;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const logger = createServiceLogger('discounts-loader');
    const errorHandler = new ErrorHandlingService(logger);
    
    const { discountRepository, productService } = createDiscountServiceStack(admin, 'discounts-loader', session.shop);
    
    // Fetch all discount rules from database
    const discountRules = await errorHandler.withErrorHandling(
      () => discountRepository.findAll(),
      { scope: 'loader.findAll' }
    );

    // Transform the data for the table
    const discounts = discountRules.map(rule => {
      let discountData;
      try {
        discountData = JSON.parse(rule.metafieldValue);
      } catch (error) {
        logger.warn('Failed to parse discount data', { ruleId: rule.id, error: error instanceof Error ? error.message : String(error) });
        discountData = {};
      }


      return {
        id: rule.id,
        discountId: rule.discountId,
        title: rule.discountTitle,
        type: rule.discountType === 'automatic' ? 'Automatic discount' : 'Discount code',
        discount: rule.discountValue || discountData.value?.displayValue || discountData.value?.percentage || 'Unknown',
        products: rule.productsCount || 0,
        status: rule.status || discountData.status || 'Unknown',
        startDate: rule.startDate || (discountData.startsAt ? new Date(discountData.startsAt) : null),
        endDate: rule.endDate || (discountData.endsAt ? new Date(discountData.endsAt) : null),
        lastRan: rule.lastRan,
        isActive: rule.isActive,
      };
    });

    // Get products count
    const productsCount = await errorHandler.withErrorHandling(
      () => productService.getProductsCount(),
      { scope: 'loader.getProductsCount' }
    );

    return json({ discounts, productsCount });
  } catch (error) {
    const logger = createServiceLogger('discounts-loader');
    const errorHandler = new ErrorHandlingService(logger);
    const appError = errorHandler.handleError(error as Error, { scope: 'loader' });
    
    // Return error response
    return json(errorHandler.createErrorResponse(appError), { status: appError.statusCode });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const logger = createServiceLogger('discounts-action');
  const errorHandler = new ErrorHandlingService(logger);

  try {
    const { admin, session } = await authenticate.admin(request);
    
    const formData = await request.formData();
    const action = formData.get('action');
    
    const { 
      discountService, 
      productDiscountService,
      productService,
      discountRepository,
      validationService: validator 
    } = createDiscountServiceStack(admin, 'discounts-action', session.shop);

    if (action === 'initialize') {
      logger.info('Starting discount initialization...');
      
      const result = await errorHandler.withErrorHandling(
        () => discountService.initializeAllDiscounts(),
        { scope: 'action.initialize' }
      );
      
      logger.info('Initialization completed', { 
        success: result.success,
        totalFound: result.totalFound,
        processed: result.processed,
        skipped: result.skipped,
        errors: result.errors
      });
      
      if (result.success) {
        return json(errorHandler.createSuccessResponse({
          processed: result.processed,
          totalFound: result.totalFound,
          skipped: result.skipped,
          errors: result.errors,
        }, `Successfully initialized ${result.processed} discounts. Found ${result.totalFound} total discounts, skipped ${result.skipped} existing ones.`));
      } else {
        throw new AppError("Failed to initialize discounts", 'INITIALIZATION_FAILED', 500, true, { error: result.error });
      }
    }

    if (action === 'refresh') {
      const ruleId = formData.get('ruleId') as string;
      
      // Validate input
      if (!ruleId || isNaN(parseInt(ruleId))) {
        throw new AppError('Invalid rule ID', 'VALIDATION_ERROR', 400, true);
      }
      
      logger.info(`Refreshing discount rule ${ruleId}...`);
      
      const { discountRepository, targetingService, metafieldService, discountService } = createDiscountServiceStack(admin, 'discounts-action');
      
      // Get the existing rule
      const existingRule = await errorHandler.withErrorHandling(
        () => discountRepository.findById(parseInt(ruleId)),
        { scope: 'action.refresh.findById', ruleId }
      );

      if (!existingRule) {
        throw new AppError("Discount rule not found", 'NOT_FOUND', 404, true, { ruleId });
      }

      // Fetch the latest discount data from Shopify
      logger.info(`Fetching latest discount data from Shopify for ${existingRule.discountId}...`);
      let latestDiscountData = null;
      try {
        latestDiscountData = await errorHandler.withErrorHandling(
          () => discountService.getDiscountFromShopify(existingRule.discountId),
          { scope: 'action.refresh.getFromShopify', discountId: existingRule.discountId }
        );
      } catch (shopifyError) {
        logger.error('Failed to fetch discount from Shopify', {
          discountId: existingRule.discountId,
          error: shopifyError instanceof Error ? shopifyError.message : String(shopifyError)
        });
        // Continue with stored data if Shopify fetch fails
      }

      if (!latestDiscountData) {
        logger.warn(`Discount ${existingRule.discountId} not found in Shopify, marking as deleted`);
        
        // Mark discount as deleted in database since it's not found in Shopify
        await errorHandler.withErrorHandling(
          () => discountRepository.updateByDiscountId(existingRule.discountId, {
            isActive: false,
            status: 'DELETED',
            lastRan: new Date(),
          }),
          { scope: 'action.refresh.markDeleted', discountId: existingRule.discountId }
        );

        try {
          // Use the discount service method that only processes products with ProductDiscount relationships
          await errorHandler.withErrorHandling(
            () => discountService.removeFromProductMetafields(existingRule, existingRule.discountId),
            { scope: 'action.refresh.removeMetafields', discountId: existingRule.discountId }
          );

          // Update the products count in the database
          await errorHandler.withErrorHandling(
            () => discountRepository.updateProductsCount(existingRule.discountId, 0),
            { scope: 'action.refresh.updateProductsCount', discountId: existingRule.discountId }
          );

          logger.info(`Removed deleted discount ${existingRule.discountId} from product metafields and relationships`);
        } catch (metafieldError) {
          logger.error('Failed to clean up metafields for deleted discount', {
            discountId: existingRule.discountId,
            error: metafieldError instanceof Error ? metafieldError.message : String(metafieldError),
          });
        }
        
        return json(errorHandler.createSuccessResponse({
          lastRan: new Date().toISOString(),
          status: 'DELETED',
          message: 'Discount not found in Shopify and marked as deleted'
        }, "Discount marked as deleted and removed from product metafields"));
      } else {
        logger.info(`Updating database with latest discount data from Shopify`);
        await errorHandler.withErrorHandling(
          () => discountRepository.updateByDiscountId(existingRule.discountId, {
            metafieldValue: JSON.stringify(latestDiscountData),
            discountTitle: latestDiscountData.title,
            status: latestDiscountData.status || 'ACTIVE',
            startDate: latestDiscountData.startsAt ? new Date(latestDiscountData.startsAt) : null,
            endDate: latestDiscountData.endsAt ? new Date(latestDiscountData.endsAt) : null,
            isActive: latestDiscountData.status === 'ACTIVE',
          }),
          { scope: 'action.refresh.updateDatabase', discountId: existingRule.discountId }
        );
      }

      const discountData = latestDiscountData || JSON.parse(existingRule.metafieldValue);

      if (discountData.status === 'ACTIVE' && discountData.id) {
        // ACTIVE DISCOUNT: Update product metafields AND create ProductDiscount relationships
        const affectedProducts = await errorHandler.withErrorHandling(
          () => targetingService.getAffectedProducts(discountData.id),
          { scope: 'action.refresh.getAffectedProducts', discountId: discountData.id }
        );

        // Use the updated discountService which now handles both metafields and relationships
        const result = await errorHandler.withErrorHandling(
          () => metafieldService.updateMultipleProductMetafields(affectedProducts, discountData),
          { scope: 'action.refresh.updateMetafields', discountId: discountData.id }
        );

        // NEW: Create ProductDiscount relationships
        await errorHandler.withErrorHandling(
          () => createProductDiscountRelationshipsForRefresh(affectedProducts, discountData, productDiscountService, discountRepository, productService, logger),
          { scope: 'action.refresh.createRelationships', discountId: discountData.id }
        );

        // Update the products count in the database
        await errorHandler.withErrorHandling(
          () => discountRepository.updateProductsCount(discountData.id, affectedProducts.length),
          { scope: 'action.refresh.updateProductsCount', discountId: discountData.id }
        );

        logger.info(`Updated ${result.successCount} product metafields and relationships for active discount ${discountData.id}`);
        
        return json(errorHandler.createSuccessResponse({
          lastRan: new Date().toISOString(),
          updatedCount: result.successCount,
        }, "Discount refreshed, product metafields updated, and relationships created"));
      } else if (!existingRule.isActive && discountData.id) {
        // INACTIVE DISCOUNT: Remove from product metafields (only products with relationships)
        logger.info(`Cleaning up inactive discount ${discountData.id} from product metafields...`);
        
        // Use the discount service method that only processes products with ProductDiscount relationships
        await errorHandler.withErrorHandling(
          () => discountService.removeFromProductMetafields(existingRule, discountData.id),
          { scope: 'action.refresh.removeMetafields', discountId: discountData.id }
        );

        // NEW: Remove ProductDiscount relationships for inactive discount
        await errorHandler.withErrorHandling(
          () => removeProductDiscountRelationshipsForRefresh(discountData.id, productDiscountService, discountRepository, logger),
          { scope: 'action.refresh.removeRelationships', discountId: discountData.id }
        );

        // Update the database
        await errorHandler.withErrorHandling(
          () => discountRepository.updateProductsCount(discountData.id, 0),
          { scope: 'action.refresh.updateProductsCount', discountId: discountData.id }
        );

        logger.info(`Removed inactive discount ${discountData.id} from product metafields and relationships`);
        
        return json(errorHandler.createSuccessResponse({
          lastRan: new Date().toISOString(),
          removedCount: 0, // The actual count is logged in the discount service
        }, "Inactive discount cleaned up from product metafields"));
      } else {
        // No discount ID or other edge case - just update timestamp
        await errorHandler.withErrorHandling(
          () => discountRepository.update(existingRule.id, { lastRan: new Date() }),
          { scope: 'action.refresh.updateTimestamp', ruleId }
        );
        
        return json(errorHandler.createSuccessResponse({
          lastRan: new Date().toISOString(),
        }, "Discount rule timestamp updated"));
      }
    }

    if (action === 'fetchProducts') {
      logger.info('Starting product fetching...');
      
      const result = await errorHandler.withErrorHandling(
        () => productService.fetchAndSaveAllProducts(),
        { scope: 'action.fetchProducts' }
      );
      
      logger.info('Product fetching completed', { 
        success: result.success,
        totalFound: result.totalFound,
        processed: result.processed,
        skipped: result.skipped,
        errors: result.errors
      });
      
      if (result.success) {
        return json(errorHandler.createSuccessResponse({
          processed: result.processed,
          totalFound: result.totalFound,
          skipped: result.skipped,
          errors: result.errors,
        }, `Successfully fetched ${result.processed} products. Found ${result.totalFound} total products, skipped ${result.skipped} existing ones.`));
      } else {
        throw new AppError("Failed to fetch products", 'PRODUCT_FETCH_FAILED', 500, true, { error: result.error });
      }
    }

    throw new AppError("Invalid action", 'INVALID_ACTION', 400, true, { action });
  } catch (error) {
    const appError = errorHandler.handleError(error as Error, { scope: 'action', action });
    return json(errorHandler.createErrorResponse(appError), { status: appError.statusCode });
  }
};

type LoaderData = SerializeFrom<typeof loader>;

// Enhanced types with relationship data
type Discount = {
  id: number;
  discountId: string;
  title: string;
  type: string;
  discount: any;
  products: number; // Keep for backward compatibility
  productCount?: number; // NEW: Count of products with this discount
  productDiscounts?: ProductDiscountSummary[]; // NEW: List of product relationships
  status: any;
  startDate: Date | null;
  endDate: Date | null;
  lastRan: Date | null;
  isActive: boolean;
};

type Product = {
  id: number;
  shopifyId: string;
  title: string;
  handle: string;
  description?: string;
  productType?: string;
  vendor?: string;
  status: string;
  variantsCount: number;
  imagesCount: number;
  tags?: string;
  activeDiscounts?: string; // Keep for backward compatibility
  discountCount?: number; // NEW: Count of discounts for this product
  productDiscounts?: ProductDiscountSummary[]; // NEW: List of discount relationships
  createdAt: Date;
  updatedAt: Date;
  lastFetchedAt: Date;
};



export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const discounts: Discount[] = 'discounts' in loaderData ? loaderData.discounts as Discount[] : [];
  const productsCount: number = 'productsCount' in loaderData ? loaderData.productsCount as number : 0;
  const navigate = useNavigate();
  const fetcher = useFetcher<{ 
    success: boolean; 
    message?: string; 
    lastRan?: string; 
    error?: string;
    processed?: number;
    totalFound?: number;
    skipped?: number;
    errors?: number;
    updatedCount?: number;
    removedCount?: number;
    status?: string;
  }>();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isFetchingProducts, setIsFetchingProducts] = useState(false);
  const [localDiscounts, setLocalDiscounts] = useState<Discount[]>(discounts);
  const [toastProps, setToastProps] = useState<{
    content: string;
    error?: boolean;
  } | null>(null);


  const handleRefresh = (ruleId: number) => {
    setLoadingId(ruleId);
    fetcher.submit(
      { action: 'refresh', ruleId: ruleId.toString() },
      { method: 'post' }
    );
  };

  const handleInitialize = () => {
    setIsInitializing(true);
    fetcher.submit(
      { action: 'initialize' },
      { method: 'post' }
    );
  };

  const handleFetchProducts = () => {
    setIsFetchingProducts(true);
    fetcher.submit(
      { action: 'fetchProducts' },
      { method: 'post' }
    );
  };

  const handleRowClick = (discountId: string) => {
    navigate(`/app/discounts/${discountId}`);
  };

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      setLoadingId(null);
      setIsInitializing(false);
      setIsFetchingProducts(false);
      
      if (fetcher.data.success) {
        if (fetcher.data.lastRan) {
          // This is a refresh response - update the local state with the new lastRan timestamp
          setLocalDiscounts(prev => 
            prev.map(discount => 
              discount.id === loadingId 
                ? { ...discount, lastRan: new Date(fetcher.data?.lastRan!) }
                : discount
            )
          );
        } else if (fetcher.data.processed !== undefined) {
          // This is an initialization or product fetch response - reload the page to show updated data
          window.location.reload();
        }
        
        // Show success toast
        setToastProps({
          content: fetcher.data.message || "Operation completed successfully"
        });
      } else if (fetcher.data.success === false) {
        // Show error toast
        setToastProps({
          content: fetcher.data.message || "Operation failed",
          error: true
        });
      }
    }
  }, [fetcher.state, fetcher.data, loadingId]);

  const rows = localDiscounts.map(discount => [
    <Link key={discount.discountId} to={`/app/discounts/${discount.discountId}`} style={{ textDecoration: 'none', color: '#0066cc' }}>
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {discount.title}
      </Text>
    </Link>,
    discount.type,
    typeof discount.discount === 'object' && discount.discount !== null 
      ? (discount.discount as any)?.displayValue || (discount.discount as any)?.percentage || 'Unknown'
      : discount.discount,
    discount.products.toString(),
    getStatusBadge(discount.status),
    formatDateTime(discount.startDate),
    formatDateTime(discount.endDate),
    <>
      {loadingId === discount.id ? (
        <InlineStack align="center" gap="100">
          <Spinner accessibilityLabel="Refreshing" size="small" />
          <Text as="span" variant="bodySm">Refreshing…</Text>
        </InlineStack>
      ) : (
        <Button
          key={`refresh-${discount.id}`}
          onClick={() => handleRefresh(discount.id)}
          size="slim"
        >
          Refresh
        </Button>
      )}
    </>,
    formatDateTime(discount.lastRan),
  ]);

  return (
    <Frame>
      <TitleBar title="Discounts as Meta Fields" />
      <Page fullWidth>
        <Layout>
          <Layout.Section variant="fullWidth">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      Discount Management
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      {productsCount} products in database
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button
                      onClick={handleFetchProducts}
                      disabled={isFetchingProducts}
                      loading={isFetchingProducts}
                      size="slim"
                    >
                      {isFetchingProducts ? "Fetching Products..." : "Fetch Products"}
                    </Button>
                    {localDiscounts.length > 0 && (
                      <Button
                        onClick={handleInitialize}
                        disabled={isInitializing}
                        loading={isInitializing}
                        size="slim"
                      >
                        {isInitializing ? "Initializing..." : "Sync All Discounts"}
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>
                
                {localDiscounts.length === 0 ? (
                  <EmptyState
                    heading="No discounts found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{
                      content: isInitializing ? "Initializing..." : "Initialize Discounts",
                      onAction: handleInitialize,
                      disabled: isInitializing
                    }}
                    secondaryAction={{
                      content: isFetchingProducts ? "Fetching Products..." : "Fetch Products",
                      onAction: handleFetchProducts,
                      disabled: isFetchingProducts
                    }}
                  >
                    <p>
                      {isInitializing 
                        ? "Fetching all existing discounts from your store and setting up metafields..."
                        : "Click 'Initialize Discounts' to fetch all existing discounts from your store and set up the necessary metafields for tracking. You can also fetch all products to see which ones have discount metafields."
                      }
                    </p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={[
                      'text',      // Discount title
                      'text',      // Discount Type
                      'text',      // Discount
                      'numeric',   // Products
                      'text',      // Status
                      'text',      // Start Date
                      'text',      // End Date
                      'text',      // Action
                      'text',      // Last Ran
                    ]}
                    headings={[
                      'Discount title',
                      'Discount Type',
                      'Discount',
                      'Products',
                      'Status',
                      'Start Date',
                      'End Date',
                      'Action',
                      'Last Ran',
                    ]}
                    rows={rows}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {toastProps && (
        <Toast
          content={toastProps.content}
          error={toastProps.error}
          onDismiss={() => setToastProps(null)}
        />
      )}
    </Frame>
  );
}
