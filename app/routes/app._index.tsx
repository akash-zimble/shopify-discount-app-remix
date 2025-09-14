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

/**
 * Optimized route handler following SOLID principles
 * Separates concerns and uses dependency injection
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    const logger = createServiceLogger('discounts-loader');
    const errorHandler = new ErrorHandlingService(logger);
    
    const { discountRepository } = createDiscountServiceStack(admin, 'discounts-loader');
    
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

    return json({ discounts });
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
    const { admin } = await authenticate.admin(request);
    
    const formData = await request.formData();
    const action = formData.get('action');
    
    const { discountService, validationService: validator } = createDiscountServiceStack(admin, 'discounts-action');

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
          const allProductIds = await errorHandler.withErrorHandling(
            () => targetingService.getAllProductIds(),
            { scope: 'action.refresh.getAllProductIds', discountId: existingRule.discountId }
          );

          if (allProductIds.length > 0) {
            const result = await errorHandler.withErrorHandling(
              () => metafieldService.removeDiscountFromMultipleProducts(allProductIds, existingRule.discountId),
              { scope: 'action.refresh.removeMetafields', discountId: existingRule.discountId }
            );

            // Update the products count in the database
            await errorHandler.withErrorHandling(
              () => discountRepository.updateProductsCount(existingRule.discountId, 0),
              { scope: 'action.refresh.updateProductsCount', discountId: existingRule.discountId }
            );

            logger.info(`Removed deleted discount ${existingRule.discountId} from ${result.successCount} product metafields`);
          }
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
        // ACTIVE DISCOUNT: Update product metafields
        const affectedProducts = await errorHandler.withErrorHandling(
          () => targetingService.getAffectedProducts(discountData.id),
          { scope: 'action.refresh.getAffectedProducts', discountId: discountData.id }
        );

        const result = await errorHandler.withErrorHandling(
          () => metafieldService.updateMultipleProductMetafields(affectedProducts, discountData),
          { scope: 'action.refresh.updateMetafields', discountId: discountData.id }
        );

        // Update the products count in the database
        await errorHandler.withErrorHandling(
          () => discountRepository.updateProductsCount(discountData.id, affectedProducts.length),
          { scope: 'action.refresh.updateProductsCount', discountId: discountData.id }
        );

        logger.info(`Updated ${result.successCount} product metafields for active discount ${discountData.id}`);
        
        return json(errorHandler.createSuccessResponse({
          lastRan: new Date().toISOString(),
          updatedCount: result.successCount,
        }, "Discount refreshed and product metafields updated"));
      } else if (!existingRule.isActive && discountData.id) {
        // INACTIVE DISCOUNT: Remove from product metafields
        logger.info(`Cleaning up inactive discount ${discountData.id} from product metafields...`);
        
        const allProductIds = await errorHandler.withErrorHandling(
          () => targetingService.getAllProductIds(),
          { scope: 'action.refresh.getAllProductIds' }
        );

        const result = await errorHandler.withErrorHandling(
          () => metafieldService.removeDiscountFromMultipleProducts(allProductIds, discountData.id),
          { scope: 'action.refresh.removeMetafields', discountId: discountData.id }
        );

        // Update the database
        await errorHandler.withErrorHandling(
          () => discountRepository.updateProductsCount(discountData.id, 0),
          { scope: 'action.refresh.updateProductsCount', discountId: discountData.id }
        );

        logger.info(`Removed inactive discount ${discountData.id} from ${result.successCount} product metafields`);
        
        return json(errorHandler.createSuccessResponse({
          lastRan: new Date().toISOString(),
          removedCount: result.successCount,
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

    throw new AppError("Invalid action", 'INVALID_ACTION', 400, true, { action });
  } catch (error) {
    const appError = errorHandler.handleError(error as Error, { scope: 'action', action });
    return json(errorHandler.createErrorResponse(appError), { status: appError.statusCode });
  }
};

type LoaderData = SerializeFrom<typeof loader>;
type Discount = {
  id: number;
  discountId: string;
  title: string;
  type: string;
  discount: any;
  products: number;
  status: any;
  startDate: Date | null;
  endDate: Date | null;
  lastRan: Date | null;
  isActive: boolean;
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const discounts: Discount[] = 'discounts' in loaderData ? loaderData.discounts as Discount[] : [];
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

  const handleRowClick = (discountId: string) => {
    navigate(`/app/discounts/${discountId}`);
  };

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      setLoadingId(null);
      setIsInitializing(false);
      
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
          // This is an initialization response - reload the page to show new discounts
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
                  <Text variant="headingMd" as="h2">
                    Discount Management
                  </Text>
                  <InlineStack gap="200">
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
                  >
                    <p>
                      {isInitializing 
                        ? "Fetching all existing discounts from your store and setting up metafields..."
                        : "Click 'Initialize Discounts' to fetch all existing discounts from your store and set up the necessary metafields for tracking."
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
