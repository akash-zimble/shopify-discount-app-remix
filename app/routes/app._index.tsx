import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import type { SerializeFrom } from "@remix-run/node";
import { Page, Layout, Text, Card, Button, BlockStack, DataTable, Badge, InlineStack, EmptyState, Spinner, Toast, Frame, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DiscountProductMatcher } from "../services/discountProductMatcher.server";
import { WebhookDiscountProcessor } from "../services/webhookDiscountProcessor.server";
import { createLogger } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Fetch all discount rules from database
  const discountRules = await prisma.discountMetafieldRule.findMany({
    orderBy: { createdAt: 'desc' }
  });

  // Transform the data for the table
  const discounts = discountRules.map(rule => {
    let discountData;
    try {
      discountData = JSON.parse(rule.metafieldValue);
    } catch {
      discountData = {};
    }

    return {
      id: rule.id,
      discountId: rule.discountId,
      title: rule.discountTitle,
      type: rule.discountType === 'automatic' ? 'Automatic discount' : 'Discount code',
      discount: rule.discountValue || discountData.value?.displayValue || 'Unknown',
      products: rule.productsCount || 0,
      status: rule.status || discountData.status || 'Unknown',
      startDate: rule.startDate || (discountData.startsAt ? new Date(discountData.startsAt) : null),
      endDate: rule.endDate || (discountData.endsAt ? new Date(discountData.endsAt) : null),
      lastRan: rule.lastRan,
      isActive: rule.isActive,
    };
  });

  return json({ discounts });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'initialize') {
    try {
      console.log('Starting discount initialization...');
      
      const logger = createLogger({ name: "manual-initialization" });
      const adminClient = createAdminWrapper(admin);
      const processor = new WebhookDiscountProcessor(adminClient, logger);

      const result = await processor.initializeAllDiscounts();
      
      console.log('Initialization completed:', result);
      
      if (result.success) {
        return json({ 
          success: true, 
          message: `Successfully initialized ${result.processed} discounts. Found ${result.totalFound} total discounts, skipped ${result.skipped} existing ones.`,
          processed: result.processed,
          totalFound: result.totalFound,
          skipped: result.skipped,
          errors: result.errors
        });
      } else {
        return json({ 
          success: false, 
          message: "Failed to initialize discounts", 
          error: result.error 
        }, { status: 500 });
      }
    } catch (error) {
      console.error("Error during initialization:", error);
      return json({ 
        success: false, 
        message: "Failed to initialize discounts", 
        error: String(error) 
      }, { status: 500 });
    }
  }

  if (action === 'refresh') {
    const ruleId = formData.get('ruleId') as string;
    
    try {
      console.log(`Refreshing discount rule ${ruleId}...`);
      
      // Get the existing rule to extract discount data
      const existingRule = await prisma.discountMetafieldRule.findUnique({
        where: { id: parseInt(ruleId) }
      });

      if (!existingRule) {
        return json({ success: false, message: "Discount rule not found" }, { status: 404 });
      }

      // Parse the stored discount data
      let discountData;
      try {
        discountData = JSON.parse(existingRule.metafieldValue);
      } catch (error) {
        console.error("Error parsing stored discount data:", error);
        return json({ success: false, message: "Invalid discount data" }, { status: 500 });
      }

      const logger = createLogger({ name: "manual-refresh" });
      const adminClient = createAdminWrapper(admin);
      const matcher = new DiscountProductMatcher(adminClient, logger);

      if (existingRule.isActive && discountData.id) {
        // ACTIVE DISCOUNT: Update product metafields with current discount data
        try {
          // Get affected products and update their metafields
          const affectedProducts = await matcher.getAffectedProducts(discountData.id);
          let updateCount = 0;
          const maxProducts = Math.min(affectedProducts.length, 10); // Limit to prevent timeouts

          for (let i = 0; i < maxProducts; i++) {
            try {
              const success = await matcher.updateProductMetafield(affectedProducts[i], discountData);
              if (success) updateCount++;
              await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
            } catch (error) {
              console.error(`Error updating product ${affectedProducts[i]}:`, error);
            }
          }

          // Update the products count in the database
          await prisma.discountMetafieldRule.update({
            where: { id: parseInt(ruleId) },
            data: { 
              lastRan: new Date(),
              productsCount: affectedProducts.length
            }
          });

          console.log(`Updated ${updateCount} product metafields for active discount ${discountData.id}`);
        } catch (error) {
          console.error("Error updating product metafields:", error);
          // Continue with database update even if product updates fail
        }
      } else if (!existingRule.isActive && discountData.id) {
        // INACTIVE DISCOUNT: Remove from product metafields to clean up
        try {
          console.log(`Cleaning up inactive discount ${discountData.id} from product metafields...`);
          
          // Get all products that might have this discount
          const allProducts = await matcher.getAllProductIds();
          let removalCount = 0;
          const maxProducts = Math.min(allProducts.length, 20); // Limit to prevent timeouts

          for (let i = 0; i < maxProducts; i++) {
            try {
              const success = await matcher.removeDiscountFromProduct(allProducts[i], discountData.id);
              if (success) removalCount++;
              await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
            } catch (error) {
              console.error(`Error removing discount from product ${allProducts[i]}:`, error);
            }
          }

          // Update the database
          await prisma.discountMetafieldRule.update({
            where: { id: parseInt(ruleId) },
            data: { 
              lastRan: new Date(),
              productsCount: 0 // Set to 0 since discount is inactive
            }
          });

          console.log(`Removed inactive discount ${discountData.id} from ${removalCount} product metafields`);
        } catch (error) {
          console.error("Error removing discount from product metafields:", error);
          // Continue with database update even if product updates fail
        }
      } else {
        // No discount ID or other edge case - just update timestamp
        await prisma.discountMetafieldRule.update({
          where: { id: parseInt(ruleId) },
          data: { lastRan: new Date() }
        });
      }
      
      const actionType = existingRule.isActive ? "updated" : "cleaned up";
      console.log(`Successfully ${actionType} discount rule ${ruleId}`);
      return json({ 
        success: true, 
        message: existingRule.isActive 
          ? "Discount refreshed and product metafields updated" 
          : "Inactive discount cleaned up from product metafields", 
        lastRan: new Date().toISOString() 
      });
    } catch (error) {
      console.error("Error refreshing discount:", error);
      return json({ success: false, message: "Failed to refresh discount", error: String(error) }, { status: 500 });
    }
  }

  return json({ success: false });
};

function createAdminWrapper(admin: any) {
  return {
    graphql: async (query: string, options: any = {}) => {
      return await admin.graphql(query, options);
    }
  } as any;
}

type Discount = SerializeFrom<typeof loader>['discounts'][0];

export default function Index() {
  const { discounts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ 
    success: boolean; 
    message?: string; 
    lastRan?: string; 
    error?: string;
    processed?: number;
    totalFound?: number;
    skipped?: number;
    errors?: number;
  }>();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [localDiscounts, setLocalDiscounts] = useState<Discount[]>(discounts);
  const [toastProps, setToastProps] = useState<{
    content: string;
    error?: boolean;
  } | null>(null);

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-GB');
  };

  const getStatusBadge = (status: string) => {
    switch (status.toUpperCase()) {
      case 'ACTIVE':
        return <Badge tone="success">Active</Badge>;
      case 'EXPIRED':
        return <Badge tone="critical">Expired</Badge>;
      case 'DISABLED':
        return <Badge tone="critical">Disabled</Badge>;
      case 'SCHEDULED':
        return <Badge tone="warning">Scheduled</Badge>;
      default:
        return <Badge tone="info">{status}</Badge>;
    }
  };

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
                ? { ...discount, lastRan: fetcher.data?.lastRan! }
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
    discount.title,
    discount.type,
    discount.discount,
    discount.products.toString(),
    getStatusBadge(discount.status),
    formatDate(discount.startDate),
    formatDate(discount.endDate),
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
                
                {localDiscounts.length === 0 ? (
                  <EmptyState
                    heading="No discounts found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{
                      content: isInitializing ? (
                        <InlineStack align="center" gap="100">
                          <Spinner accessibilityLabel="Initializing" size="small" />
                          <Text as="span" variant="bodySm">Initializing...</Text>
                        </InlineStack>
                      ) : (
                        "Initialize Discounts"
                      ),
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
