import MistralClient, {
  ChatCompletionResponseChunk,
  ResponseFormat,
  ToolChoice,
} from '@mistralai/mistralai';
import {
  ErrorStreamPart,
  LanguageModel,
  LanguageModelSettings,
  LanguageModelStreamPart,
  ObjectMode,
} from '../../core';
import { injectJsonSchemaIntoInstructionPrompt } from '../../core/language-model/generate-object/inject-json-schema-into-instruction-prompt';
import { ChatPrompt } from '../../core/language-model/prompt/chat-prompt';
import { InstructionPrompt } from '../../core/language-model/prompt/instruction-prompt';
import { readableFromAsyncIterable } from '../../streams/ai-stream';
import {
  convertChatPromptToMistralChatPrompt,
  convertInstructionPromptToMistralChatPrompt,
  convertToMistralChatPrompt,
} from './mistral-chat-prompt';

export type MistralChatModelType =
  | 'open-mistral-7b'
  | 'open-mixtral-8x7b'
  | 'mistral-small-latest'
  | 'mistral-medium-latest'
  | 'mistral-large-latest'
  | (string & {});

export interface MistralChatLanguageModelSettings
  extends LanguageModelSettings {
  client: () => Promise<MistralClient>;

  /**
   * The ID of the model to use.
   */
  id: MistralChatModelType;

  objectMode?: ObjectMode;

  /**
   * What sampling temperature to use, between 0.0 and 1.0.
   * Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.
   *
   * Default: 0.7
   */
  temperature?: number;

  /**
   * Nucleus sampling, where the model considers the results of the tokens with top_p probability mass.
   * So 0.1 means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or temperature but not both.
   *
   * Default: 1
   */
  topP?: number;

  /**
   * The seed to use for random sampling. If set, different calls will generate deterministic results.
   *
   * Default: undefined
   */
  randomSeed?: number;

  /**
   * Whether to inject a safety prompt before all conversations.
   *
   * Default: false
   */
  safePrompt?: boolean;
}

export class MistralChatLanguageModel implements LanguageModel {
  readonly settings: MistralChatLanguageModelSettings;

  constructor(settings: MistralChatLanguageModelSettings) {
    this.settings = settings;
  }

  private getClient(): Promise<MistralClient> {
    return this.settings.client();
  }

  get objectMode(): ObjectMode {
    return this.settings.objectMode ?? 'json';
  }

  private get basePrompt() {
    return {
      model: this.settings.id,

      maxTokens: this.settings.maxTokens,

      temperature: this.settings.temperature,
      topP: this.settings.topP,
      randomSeed: this.settings.randomSeed,
      safePrompt: this.settings.safePrompt,
    };
  }

  async doGenerate({ prompt }: { prompt: ChatPrompt | InstructionPrompt }) {
    const client = await this.getClient();
    const clientResponse = await client.chat({
      ...this.basePrompt,
      messages: convertToMistralChatPrompt(prompt),
    });

    return {
      text: clientResponse.choices[0].message.content!,
    };
  }

  async doStream({
    prompt,
    tools,
  }: {
    prompt: InstructionPrompt | ChatPrompt;
    tools?: Array<{
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    }>;
  }): Promise<ReadableStream<LanguageModelStreamPart>> {
    const client = await this.getClient();

    const response = client.chatStream({
      ...this.basePrompt,
      messages: convertToMistralChatPrompt(prompt),
    });

    return readableFromAsyncIterable(response).pipeThrough(
      new TransformStream<ChatCompletionResponseChunk, LanguageModelStreamPart>(
        {
          transform(chunk, controller) {
            if (chunk.choices?.[0].delta == null) {
              return;
            }

            const delta = chunk.choices[0].delta;

            if (delta.content != null) {
              controller.enqueue({
                type: 'text-delta',
                textDelta: delta.content,
              });
            }
          },
        },
      ),
    );
  }

  async doGenerateJsonText({
    mode,
    prompt,
  }: Parameters<LanguageModel['doGenerateJsonText']>[0]) {
    const type = mode.type;
    const messages = convertChatPromptToMistralChatPrompt(prompt);
    const client = await this.getClient();

    switch (type) {
      case 'json': {
        const clientResponse = await client.chat({
          ...this.basePrompt,
          responseFormat: { type: 'json_object' } as ResponseFormat,
          messages,
        });

        // TODO extract standard response processing
        return {
          text: clientResponse.choices[0].message.content,
        };
      }

      case 'tool': {
        const clientResponse = await client.chat({
          ...this.basePrompt,
          toolChoice: 'any' as ToolChoice,
          tools: [
            {
              type: 'function',
              function: {
                name: mode.tool.name,
                description: mode.tool.description ?? '',
                parameters: mode.tool.parameters,
              },
            },
          ],
          messages,
        });

        // Note: correct types not supported by MistralClient as of 2024-Feb-28
        const message = clientResponse.choices[0].message as any;

        // TODO extract standard response processing
        return {
          toolCalls: message.tool_calls?.map((toolCall: any) => ({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            args: toolCall.function.arguments,
          })),
        };
      }

      default: {
        const _exhaustiveCheck: never = type;
        throw new Error(`Unsupported type: ${_exhaustiveCheck}`);
      }
    }
  }

  async doStreamJsonText({
    mode,
    prompt,
  }: Parameters<LanguageModel['doStreamJsonText']>[0]): Promise<
    ReadableStream<
      { type: 'json-text-delta'; textDelta: string } | ErrorStreamPart
    >
  > {
    const type = mode.type;
    const messages = convertChatPromptToMistralChatPrompt(prompt);
    const client = await this.getClient();

    switch (type) {
      case 'json': {
        const response = client.chatStream({
          ...this.basePrompt,
          responseFormat: { type: 'json_object' } as ResponseFormat,
          messages,
        });

        return readableFromAsyncIterable(response).pipeThrough(
          new TransformStream<
            ChatCompletionResponseChunk,
            { type: 'json-text-delta'; textDelta: string } | ErrorStreamPart
          >({
            transform(chunk, controller) {
              if (chunk.choices?.[0].delta == null) {
                return;
              }

              const delta = chunk.choices[0].delta;

              if (delta.content != null) {
                controller.enqueue({
                  type: 'json-text-delta',
                  textDelta: delta.content,
                });
              }
            },
          }),
        );
      }

      case 'tool': {
        const response = client.chatStream({
          ...this.basePrompt,
          toolChoice: 'any' as ToolChoice,
          tools: [
            {
              type: 'function',
              function: {
                name: mode.tool.name,
                description: mode.tool.description ?? '',
                parameters: mode.tool.parameters,
              },
            },
          ],
          messages,
        });

        return readableFromAsyncIterable(response).pipeThrough(
          new TransformStream<
            ChatCompletionResponseChunk,
            { type: 'json-text-delta'; textDelta: string } | ErrorStreamPart
          >({
            transform(chunk, controller) {
              if (chunk.choices?.[0].delta == null) {
                return;
              }

              const delta = chunk.choices[0].delta;

              if (delta.content != null) {
                controller.enqueue({
                  type: 'json-text-delta',
                  // Note: Mistral does not support tool streaming as of 2024-Feb-28
                  // The result come in a single chunk as content.
                  textDelta: delta.content,
                });
              }
            },
          }),
        );
      }

      default: {
        const _exhaustiveCheck: never = type;
        throw new Error(`Unsupported type: ${_exhaustiveCheck}`);
      }
    }
  }
}
