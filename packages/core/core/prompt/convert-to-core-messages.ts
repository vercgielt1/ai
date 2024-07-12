import { MessageFile } from '@ai-sdk/ui-utils';
import { ToolResult } from '../generate-text/tool-result';
import { CoreMessage } from '../prompt';
import { filesToParts } from './files-to-parts';

/**
Converts an array of messages from useChat into an array of CoreMessages that can be used
with the AI core functions (e.g. `streamText`).
 */
export function convertToCoreMessages(
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    toolInvocations?: Array<ToolResult<string, unknown, unknown>>;
    experimental_files?: MessageFile[];
  }>,
) {
  const coreMessages: CoreMessage[] = [];

  for (const {
    role,
    content,
    toolInvocations,
    experimental_files,
  } of messages) {
    switch (role) {
      case 'user': {
        coreMessages.push({
          role: 'user',
          content: experimental_files
            ? [
                { type: 'text', text: content },
                ...filesToParts(experimental_files),
              ]
            : content,
        });
        break;
      }

      case 'assistant': {
        if (toolInvocations == null) {
          coreMessages.push({ role: 'assistant', content });
          break;
        }

        // assistant message with tool calls
        coreMessages.push({
          role: 'assistant',
          content: [
            { type: 'text', text: content },
            ...toolInvocations.map(({ toolCallId, toolName, args }) => ({
              type: 'tool-call' as const,
              toolCallId,
              toolName,
              args,
            })),
          ],
        });

        // tool message with tool results
        coreMessages.push({
          role: 'tool',
          content: toolInvocations.map(
            ({ toolCallId, toolName, args, result }) => ({
              type: 'tool-result' as const,
              toolCallId,
              toolName,
              args,
              result,
            }),
          ),
        });

        break;
      }

      default: {
        const _exhaustiveCheck: never = role;
        throw new Error(`Unhandled role: ${_exhaustiveCheck}`);
      }
    }
  }

  return coreMessages;
}
