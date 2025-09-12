import { IAdminClient } from './interfaces/IAdminClient';
import { Logger } from '../utils/logger.server';
import { validationService } from './validation.service';

/**
 * Admin client service implementation
 * Provides a clean interface for Shopify GraphQL API interactions
 */
export class AdminClientService implements IAdminClient {
  constructor(
    private admin: any, // Shopify admin object with built-in GraphQL client
    private logger: Logger
  ) {}

  async graphql(query: string, options: { variables?: Record<string, any> } = {}): Promise<Response> {
    try {
      // Validate inputs
      if (!query || typeof query !== 'string') {
        throw new Error('GraphQL query is required and must be a string');
      }

      if (!this.admin) {
        throw new Error('Admin client is not available');
      }

      this.logger.debug('Making GraphQL request', {
        queryLength: query.length,
        hasVariables: !!options.variables,
      });

      // Use the admin object's built-in GraphQL client
      const response = await this.admin.graphql(query, options);
      return response;
    } catch (error) {
      this.logger.error(error as Error, {
        scope: 'AdminClientService.graphql',
        queryLength: query?.length,
      });
      throw error;
    }
  }

  /**
   * Execute GraphQL query and return parsed JSON
   */
  async executeQuery<T = any>(query: string, options: { variables?: Record<string, any> } = {}): Promise<T> {
    const response = await this.graphql(query, options);
    const responseData = await response.json();
    
    // Validate response
    const validation = validationService.validateGraphQLResponse(responseData);
    
    if (!validation.isValid) {
      this.logger.warn('GraphQL response validation failed', {
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }
    
    return responseData;
  }

  /**
   * Execute GraphQL mutation and return parsed JSON
   */
  async executeMutation<T = any>(mutation: string, options: { variables?: Record<string, any> } = {}): Promise<T> {
    return this.executeQuery<T>(mutation, options);
  }

}

