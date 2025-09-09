import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Text, Card, Button, BlockStack, DataTable, Badge, InlineStack, EmptyState, Spinner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
  await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'refresh') {
    const discountId = formData.get('discountId') as string;
    
    try {
      console.log(`Refreshing discount ${discountId}...`);
      
      // Update the lastRan timestamp
      const updated = await prisma.discountMetafieldRule.update({
        where: { id: parseInt(discountId) },
        data: { lastRan: new Date() }
      });
      
      console.log(`Successfully updated discount ${discountId}, lastRan: ${updated.lastRan}`);
      return json({ success: true, message: "Discount refreshed successfully", lastRan: updated.lastRan });
    } catch (error) {
      console.error("Error updating lastRan:", error);
      return json({ success: false, message: "Failed to refresh discount", error: String(error) }, { status: 500 });
    }
  }

  return json({ success: false });
};

export default function Index() {
  const { discounts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [loadingId, setLoadingId] = useState<number | null>(null);

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

  const handleRefresh = (discountId: number) => {
    setLoadingId(discountId);
    fetcher.submit(
      { action: 'refresh', discountId: discountId.toString() },
      { method: 'post' }
    );
  };

  useEffect(() => {
    if (fetcher.state === 'idle') {
      setLoadingId(null);
    }
  }, [fetcher.state]);

  const rows = discounts.map(discount => [
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
    <>
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
                </InlineStack>
                
                {discounts.length === 0 ? (
                  <EmptyState
                    heading="No discounts found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Create your first discount to get started.</p>
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
    </>
  );
}
