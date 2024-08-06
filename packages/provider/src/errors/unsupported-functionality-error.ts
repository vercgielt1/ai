import { AISDKError } from './ai-sdk-error';

const marker = 'vercel.ai.error.api-call-error';
const symbol = Symbol.for(marker);

export class UnsupportedFunctionalityError extends AISDKError {
  private readonly [symbol] = true; // used in isInstance

  readonly functionality: string;

  constructor({ functionality }: { functionality: string }) {
    super({
      name: 'AI_UnsupportedFunctionalityError',
      message: `'${functionality}' functionality not supported.`,
    });

    this.functionality = functionality;
  }

  static isInstance(error: unknown): error is UnsupportedFunctionalityError {
    return AISDKError.hasMarker(error, marker);
  }

  /**
   * @deprecated Use isInstance instead.
   */
  static isUnsupportedFunctionalityError(
    error: unknown,
  ): error is UnsupportedFunctionalityError {
    return (
      error instanceof Error &&
      error.name === 'AI_UnsupportedFunctionalityError' &&
      typeof (error as UnsupportedFunctionalityError).functionality === 'string'
    );
  }

  /**
   * @deprecated Do not use this method. It will be removed in the next major version.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,

      functionality: this.functionality,
    };
  }
}
