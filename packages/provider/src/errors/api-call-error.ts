import { AISDKError } from './ai-sdk-error';

const marker = Symbol.for('vercel.ai.error.api-call-error');

export class APICallError extends AISDKError {
  private readonly [marker] = true; // used in isInstance

  readonly url: string;
  readonly requestBodyValues: unknown;
  readonly statusCode?: number;

  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: string;

  readonly isRetryable: boolean;
  readonly data?: unknown;

  constructor({
    message,
    url,
    requestBodyValues,
    statusCode,
    responseHeaders,
    responseBody,
    cause,
    isRetryable = statusCode != null &&
      (statusCode === 408 || // request timeout
        statusCode === 409 || // conflict
        statusCode === 429 || // too many requests
        statusCode >= 500), // server error
    data,
  }: {
    message: string;
    url: string;
    requestBodyValues: unknown;
    statusCode?: number;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    cause?: unknown;
    isRetryable?: boolean;
    data?: unknown;
  }) {
    super({
      name: 'AI_APICallError',
      message,
      cause,
    });

    this.url = url;
    this.requestBodyValues = requestBodyValues;
    this.statusCode = statusCode;
    this.responseHeaders = responseHeaders;
    this.responseBody = responseBody;
    this.isRetryable = isRetryable;
    this.data = data;
  }

  static isInstance(error: unknown): error is APICallError {
    return (
      error != null &&
      (error instanceof APICallError ||
        (typeof error === 'object' &&
          marker in error &&
          typeof error[marker] === 'boolean' &&
          error[marker] === true))
    );
  }

  /**
   * @deprecated Use isInstance instead.
   */
  static isAPICallError(error: unknown): error is APICallError {
    return (
      error instanceof Error &&
      error.name === 'AI_APICallError' &&
      typeof (error as APICallError).url === 'string' &&
      typeof (error as APICallError).requestBodyValues === 'object' &&
      ((error as APICallError).statusCode == null ||
        typeof (error as APICallError).statusCode === 'number') &&
      ((error as APICallError).responseHeaders == null ||
        typeof (error as APICallError).responseHeaders === 'object') &&
      ((error as APICallError).responseBody == null ||
        typeof (error as APICallError).responseBody === 'string') &&
      ((error as APICallError).cause == null ||
        typeof (error as APICallError).cause === 'object') &&
      typeof (error as APICallError).isRetryable === 'boolean' &&
      ((error as APICallError).data == null ||
        typeof (error as APICallError).data === 'object')
    );
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      url: this.url,
      requestBodyValues: this.requestBodyValues,
      statusCode: this.statusCode,
      responseHeaders: this.responseHeaders,
      responseBody: this.responseBody,
      cause: this.cause,
      isRetryable: this.isRetryable,
      data: this.data,
    };
  }
}
