import { Logger } from '../utils/logger.server';

/**
 * Custom error types for better error handling
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, true, context);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'NOT_FOUND', 404, true, context);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'UNAUTHORIZED', 401, true, context);
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, true, context);
    this.name = 'RateLimitError';
  }
}

export class ShopifyAPIError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SHOPIFY_API_ERROR', 502, true, context);
    this.name = 'ShopifyAPIError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', 500, true, context);
    this.name = 'DatabaseError';
  }
}

/**
 * Error handling service
 * Provides centralized error handling and logging
 */
export class ErrorHandlingService {
  constructor(private logger: Logger) {}

  /**
   * Handle and log errors with appropriate context
   */
  handleError(error: Error, context: Record<string, any> = {}): AppError {
    // If it's already an AppError, just log and return
    if (error instanceof AppError) {
      this.logError(error, context);
      return error;
    }

    // Convert common errors to AppError
    let appError: AppError;

    if (error.name === 'ValidationError' || error.message.includes('validation')) {
      appError = new ValidationError(error.message, { ...context, originalError: error.message });
    } else if (error.name === 'NotFoundError' || error.message.includes('not found')) {
      appError = new NotFoundError(error.message, { ...context, originalError: error.message });
    } else if (error.name === 'UnauthorizedError' || error.message.includes('unauthorized')) {
      appError = new UnauthorizedError(error.message, { ...context, originalError: error.message });
    } else if (error.message.includes('rate limit') || error.message.includes('throttle')) {
      appError = new RateLimitError(error.message, { ...context, originalError: error.message });
    } else if (error.message.includes('shopify') || error.message.includes('graphql')) {
      appError = new ShopifyAPIError(error.message, { ...context, originalError: error.message });
    } else if (error.message.includes('database') || error.message.includes('prisma')) {
      appError = new DatabaseError(error.message, { ...context, originalError: error.message });
    } else {
      appError = new AppError(error.message, 'UNKNOWN_ERROR', 500, false, { ...context, originalError: error.message });
    }

    this.logError(appError, context);
    return appError;
  }

  /**
   * Log error with appropriate level based on error type
   */
  private logError(error: AppError, context: Record<string, any>): void {
    const logContext = {
      ...context,
      errorCode: error.code,
      statusCode: error.statusCode,
      isOperational: error.isOperational,
      stack: error.stack,
    };

    if (error.isOperational) {
      this.logger.warn(error.message, logContext);
    } else {
      this.logger.error(error, logContext);
    }
  }

  /**
   * Create a standardized error response
   */
  createErrorResponse(error: AppError): {
    success: false;
    error: {
      code: string;
      message: string;
      statusCode: number;
      context?: Record<string, any>;
    };
  } {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        context: error.context,
      },
    };
  }

  /**
   * Create a standardized success response
   */
  createSuccessResponse<T>(data: T, message?: string): {
    success: true;
    data: T;
    message?: string;
  } {
    return {
      success: true,
      data,
      ...(message && { message }),
    };
  }

  /**
   * Wrap async function with error handling
   */
  async withErrorHandling<T>(
    fn: () => Promise<T>,
    context: Record<string, any> = {}
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const appError = this.handleError(error as Error, context);
      throw appError;
    }
  }

  /**
   * Wrap sync function with error handling
   */
  withSyncErrorHandling<T>(
    fn: () => T,
    context: Record<string, any> = {}
  ): T {
    try {
      return fn();
    } catch (error) {
      const appError = this.handleError(error as Error, context);
      throw appError;
    }
  }


  /**
   * Validate and throw validation error if invalid
   */
  validateOrThrow(condition: boolean, message: string, context?: Record<string, any>): void {
    if (!condition) {
      throw new ValidationError(message, context);
    }
  }

  /**
   * Check if error is operational (expected) or programming error
   */
  isOperationalError(error: Error): boolean {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalErrors: number;
    operationalErrors: number;
    programmingErrors: number;
    errorTypes: Record<string, number>;
  } {
    // This would typically be implemented with a metrics service
    // For now, return mock data
    return {
      totalErrors: 0,
      operationalErrors: 0,
      programmingErrors: 0,
      errorTypes: {},
    };
  }
}

/**
 * Global error handler for unhandled promise rejections
 */
export function setupGlobalErrorHandlers(logger: Logger): void {
  const errorHandler = new ErrorHandlingService(logger);

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    errorHandler.handleError(error, {
      type: 'unhandledRejection',
      promise: promise.toString(),
    });
  });

  process.on('uncaughtException', (error: Error) => {
    errorHandler.handleError(error, {
      type: 'uncaughtException',
    });
    
    // Exit process for uncaught exceptions
    process.exit(1);
  });
}

/**
 * Express/Remix error handler middleware
 */
export function createErrorHandler(logger: Logger) {
  const errorHandler = new ErrorHandlingService(logger);

  return (error: Error, request: any, response: any, next: any) => {
    const appError = errorHandler.handleError(error, {
      url: request.url,
      method: request.method,
      userAgent: request.headers['user-agent'],
    });

    const errorResponse = errorHandler.createErrorResponse(appError);
    
    response.status(appError.statusCode).json(errorResponse);
  };
}
