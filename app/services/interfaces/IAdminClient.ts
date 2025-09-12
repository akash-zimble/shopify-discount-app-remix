/**
 * Interface for Shopify Admin API client
 * Abstracts the GraphQL client to enable dependency injection and testing
 */
export interface IAdminClient {
  graphql(query: string, options?: { variables?: Record<string, any> }): Promise<Response>;
  executeQuery<T = any>(query: string, options?: { variables?: Record<string, any> }): Promise<T>;
  executeMutation<T = any>(mutation: string, options?: { variables?: Record<string, any> }): Promise<T>;
}

