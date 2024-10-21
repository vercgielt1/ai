import { CallSettings } from '../prompt/call-settings';
import { CoreToolChoice, LanguageModel } from '../types/language-model';

/**
 * Used to mark update instruction tool results.
 */
const validatorSymbol = Symbol.for('vercel.ai.validator');

export type Instruction = {
  /**
The language model to use.
   */
  model?: LanguageModel;
  /**
System message to include in the prompt. Can be used with `prompt` or `messages`.
 */
  system?: string;
  /**
Active tools.
*/
  activeTools?: Array<string>; // Note: not type safe
  toolChoice?: CoreToolChoice<Record<string, unknown>>; // Note: not type safe
} & Omit<CallSettings, 'maxRetries' | 'abortSignal' | 'headers'>;

export function experimental_updateInstructionToolResult(
  instructionDelta: Instruction,
) {
  return {
    [validatorSymbol]: true,
    ...instructionDelta,
  };
}

export function isUpdateInstructionToolResult(
  value: unknown,
): value is Instruction {
  return (
    typeof value === 'object' &&
    value !== null &&
    validatorSymbol in value &&
    value[validatorSymbol] === true
  );
}
