import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  ButtonGroup,
  Box,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createDiscountServiceStack, createServiceLogger } from "../services/service-factory";
import { ErrorHandlingService } from "../services/error-handling.service";
import { json } from "@remix-run/node";
import { getStatusBadge, getDiscountTypeBadge } from "../utils/ui.utils";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { discountId } = params;
  
  if (!discountId) {
    throw new Response("Discount not found", { status: 404 });
  }

  const logger = createServiceLogger('discount-detail');
  const errorHandler = new ErrorHandlingService(logger);

  try {
    const { discountRepository, productDiscountService } = createDiscountServiceStack(admin, 'discount-detail');

    // Get discount details from database
    let discount = await errorHandler.withErrorHandling(
      () => discountRepository.findByDiscountId(discountId),
      { scope: 'loader.findDiscount', discountId }
    );

    // If not found, try alternative ID formats
    if (!discount) {
      logger.info('Discount not found with original ID, trying alternative formats', { discountId });
      
      // Try with gid:// prefix
      const gidFormat = `gid://shopify/DiscountAutomaticNode/${discountId}`;
      discount = await errorHandler.withErrorHandling(
        () => discountRepository.findByDiscountId(gidFormat),
        { scope: 'loader.findDiscount.gid', discountId: gidFormat }
      );
      
      if (!discount) {
        // Try extracting numeric part if it's a GraphQL ID
        const numericId = discountId.includes('/') ? discountId.split('/').pop() : discountId;
        if (numericId && numericId !== discountId) {
          logger.info('Trying numeric ID extraction', { originalId: discountId, numericId });
          discount = await errorHandler.withErrorHandling(
            () => discountRepository.findByDiscountId(numericId),
            { scope: 'loader.findDiscount.numeric', discountId: numericId }
          );
        }
      }
    }

    if (!discount) {
      logger.error('Discount not found with any ID format', { discountId });
      throw new Response("Discount not found", { status: 404 });
    }

    // Parse discount data
    let discountData: any = {};
    try {
      discountData = JSON.parse(discount.metafieldValue || '{}');
    } catch (error) {
      logger.warn('Failed to parse discount data', { discountId, error: error instanceof Error ? error.message : String(error) });
    }

    // Get products associated with this discount
    let discountProducts: any[] = [];
    try {
      discountProducts = await errorHandler.withErrorHandling(
        () => productDiscountService.getDiscountProducts(discount.id),
        { scope: 'loader.getDiscountProducts', discountId: discount.id }
      );
      logger.info('Fetched discount products', { 
        discountId: discount.id, 
        productsCount: discountProducts.length 
      });
    } catch (error) {
      logger.warn('Failed to fetch discount products', { 
        discountId: discount.id, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    return json({
      discount,
      discountData,
      discountProducts,
      discountId
    });

  } catch (error) {
    const appError = errorHandler.handleError(error as Error, { scope: 'loader', discountId });
    logger.error('Error in discount detail loader', { error: appError.message, context: appError.context });
    throw error;
  }
};

export default function DiscountDetailPage() {
  try {
    const { discount, discountData, discountProducts, discountId } = useLoaderData<typeof loader>();
    
    
    if (!discount) {
      return (
        <Page>
          <Layout>
            <Layout.Section>
              <Card>
                <Text as="p">Discount not found</Text>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      );
    }


    return (
      <Page>
        <TitleBar title={`Discount: ${discount.discountTitle}`} />
        
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Discount Details
                  </Text>
                  <ButtonGroup>
                    <Button url={`/app`}>
                      Back to Home
                    </Button>
                  </ButtonGroup>
                </InlineStack>
                
                <InlineStack gap="200">
                  {getStatusBadge(discount.status)}
                  {getDiscountTypeBadge(discount.discountType)}
                </InlineStack>

                <BlockStack gap="300">
                  <InlineStack gap="400">
                    <Box>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Title:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {discount.discountTitle}
                      </Text>
                    </Box>
                    <Box>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Type:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {discount.discountType}
                      </Text>
                    </Box>
                  </InlineStack>

                  <InlineStack gap="400">
                    <Box>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Status:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {discount.status}
                      </Text>
                    </Box>
                    <Box>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Products Count:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {discount.productsCount || 0}
                      </Text>
                    </Box>
                  </InlineStack>

                  <InlineStack gap="400">
                    <Box>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Created:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {new Date(discount.createdAt).toLocaleDateString()}
                      </Text>
                    </Box>
                    <Box>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Last Updated:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {discount.updatedAt ? new Date(discount.updatedAt).toLocaleDateString() : 'N/A'}
                      </Text>
                    </Box>
                  </InlineStack>

                  {discountData && Object.keys(discountData).length > 0 && (
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        Discount Information
                      </Text>
                      <InlineStack gap="400">
                        <Box>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Value:
                          </Text>
                          <Text as="p" variant="bodyMd">
                            {discountData.value?.displayValue || discountData.value?.percentage || 'N/A'}
                          </Text>
                        </Box>
                        <Box>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Code:
                          </Text>
                          <Text as="p" variant="bodyMd">
                            {discountData.code || 'N/A'}
                          </Text>
                        </Box>
                      </InlineStack>
                      <InlineStack gap="400">
                        <Box>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Summary:
                          </Text>
                          <Text as="p" variant="bodyMd">
                            {discountData.summary || 'N/A'}
                          </Text>
                        </Box>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Products Section */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Associated Products
                  </Text>
                  <Badge tone="info">
                    {`${discountProducts.length} product${discountProducts.length !== 1 ? 's' : ''}`}
                  </Badge>
                </InlineStack>

                {discountProducts.length > 0 ? (
                  <DataTable
                    columnContentTypes={[
                      'text',
                      'text', 
                      'text',
                      'text',
                      'text'
                    ]}
                    headings={[
                      'Product Title',
                      'Shopify ID',
                      'Status',
                      'Relationship Status',
                      'Relationship Created'
                    ]}
                    rows={discountProducts.map((productDiscount: any) => [
                      productDiscount.product?.title || 'Unknown Product',
                      productDiscount.product?.shopifyId || 'N/A',
                      productDiscount.product?.status || 'N/A',
                      productDiscount.isActive ? 'Active' : 'Inactive',
                      new Date(productDiscount.createdAt).toLocaleString()
                    ])}
                  />
                ) : (
                  <Box padding="400">
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      No products are currently associated with this discount.
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>


        {/* Raw Data (for debugging) */}
        {process.env.NODE_ENV === 'development' && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Raw Discount Data (Development Only)
                  </Text>
                  <Box padding="300" background="bg-surface-secondary">
                    <pre style={{ fontSize: '12px', overflow: 'auto' }}>
                      {JSON.stringify(discountData, null, 2)}
                    </pre>
                  </Box>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}
      </Page>
    );

  } catch (error) {
    console.error("Error in DiscountDetailPage component:", error);
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p">Error loading discount: {error instanceof Error ? error.message : String(error)}</Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
}