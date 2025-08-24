import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  // Fetch discounts from Shopify
  const response = await admin.graphql(`
    #graphql
    query getDiscounts {
      discountNodes(first: 10) {
        edges {
          node {
            id
            discount {
              ... on DiscountCodeBasic {
                title
                status
                summary
              }
              ... on DiscountCodeBxgy {
                title
                status
                summary
              }
              ... on DiscountCodeFreeShipping {
                title
                status
                summary
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  
  return {
    discounts: data.data?.discountNodes?.edges || []
  };
};

export default function DiscountsPage() {
  const { discounts } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Discount Metafield Manager">
        <button variant="primary">
          Create Metafield Rule
        </button>
      </TitleBar>
      
      <BlockStack gap="500">
        <Banner tone="info">
          <Text as="p">
            This dashboard shows your store's discounts and allows you to automatically 
            manage product metafields based on discount associations.
          </Text>
        </Banner>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Active Discounts ({discounts.length})
                </Text>
                
                {discounts.length > 0 ? (
                  <BlockStack gap="300">
                    {discounts.map((edge: any, index: number) => {
                      const discount = edge.node.discount;
                      return (
                        <Card key={index} background="bg-surface-secondary">
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              {discount.title}
                            </Text>
                            <Text as="span" variant="bodyMd" tone="subdued">
                              Status: {discount.status} | {discount.summary}
                            </Text>
                            <Button size="slim" variant="plain">
                              Manage Metafields
                            </Button>
                          </BlockStack>
                        </Card>
                      );
                    })}
                  </BlockStack>
                ) : (
                  <EmptyState
                    heading="No discounts found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <Text as="p">
                      Create some discounts in your Shopify admin to get started 
                      with automated metafield management.
                    </Text>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Metafield Rules
                </Text>
                <Text as="span" variant="bodyMd" tone="subdued">
                  No automated rules configured yet. 
                  Create your first rule to start managing product metafields 
                  based on discount associations.
                </Text>
                <Button>Set up first rule</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
