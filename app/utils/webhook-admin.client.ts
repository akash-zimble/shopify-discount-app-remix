/**
 * Utility function to create an admin object from session data for webhook processing
 * This is needed because webhooks don't have the same authentication context as regular admin requests
 */
export function createWebhookAdminClient(session: any) {
  return {
    graphql: async (query: string, options: { variables?: Record<string, any> } = {}) => {
      const url = `https://${session.shop}/admin/api/2025-07/graphql.json`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken!,
        },
        body: JSON.stringify({
          query,
          variables: options.variables || {},
        }),
      });

      return response;
    }
  };
}
