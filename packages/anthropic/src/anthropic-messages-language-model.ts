import {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2FunctionTool,
  LanguageModelV2FunctionToolCall,
  LanguageModelV2StreamChunk,
  LanguageModelV2ToolChoice,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  ParseResult,
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { anthropicFailedResponseHandler } from './anthropic-error';
import {
  AnthropicMessagesModelId,
  AnthropicMessagesSettings,
} from './anthropic-messages-settings';
import { convertToAnthropicMessagesPrompt } from './convert-to-anthropic-messages-prompt';
import { mapAnthropicStopReason } from './map-anthropic-stop-reason';

type AnthropicMessagesConfig = {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
};

export class AnthropicMessagesLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';
  readonly defaultObjectGenerationMode = 'tool';
  readonly supportsImageUrls = false;
  readonly supportsGrammarGuidedGeneration = false;

  readonly modelId: AnthropicMessagesModelId;
  readonly settings: AnthropicMessagesSettings;

  private readonly config: AnthropicMessagesConfig;

  constructor(
    modelId: AnthropicMessagesModelId,
    settings: AnthropicMessagesSettings,
    config: AnthropicMessagesConfig,
  ) {
    this.modelId = modelId;
    this.settings = settings;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  private async getArgs({
    tools,
    toolChoice,
    prompt,
    maxTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    stopSequences,
    responseFormat,
    seed,
  }: Parameters<LanguageModelV2['doGenerate']>[0]) {
    const warnings: LanguageModelV2CallWarning[] = [];

    if (frequencyPenalty != null) {
      warnings.push({
        type: 'unsupported-setting',
        setting: 'frequencyPenalty',
      });
    }

    if (presencePenalty != null) {
      warnings.push({
        type: 'unsupported-setting',
        setting: 'presencePenalty',
      });
    }

    if (seed != null) {
      warnings.push({
        type: 'unsupported-setting',
        setting: 'seed',
      });
    }

    if (responseFormat != null && responseFormat.type !== 'text') {
      warnings.push({
        type: 'unsupported-setting',
        setting: 'responseFormat',
        details: 'JSON response format is not supported.',
      });
    }

    const messagesPrompt = convertToAnthropicMessagesPrompt(prompt);

    const baseArgs = {
      // model id:
      model: this.modelId,

      // model specific settings:
      top_k: topK ?? this.settings.topK,

      // standardized settings:
      max_tokens: maxTokens ?? 4096, // 4096: max model output tokens
      temperature,
      top_p: topP,
      stop_sequences: stopSequences,

      // prompt:
      system: messagesPrompt.system,
      messages: messagesPrompt.messages,
    };

    return {
      args: {
        ...baseArgs,
        ...prepareToolsAndToolChoice({ tools, toolChoice }),
      },
      warnings,
    };
  }

  async doGenerate(
    options: Parameters<LanguageModelV2['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    const { args, warnings } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/messages`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: anthropicFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        anthropicMessagesResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const { messages: rawPrompt, ...rawSettings } = args;

    // extract text
    let text = '';
    for (const content of response.content) {
      if (content.type === 'text') {
        text += content.text;
      }
    }

    // extract tool calls
    let toolCalls: LanguageModelV2FunctionToolCall[] | undefined = undefined;
    if (response.content.some(content => content.type === 'tool_use')) {
      toolCalls = [];
      for (const content of response.content) {
        if (content.type === 'tool_use') {
          toolCalls.push({
            toolCallType: 'function',
            toolCallId: content.id,
            toolName: content.name,
            args: JSON.stringify(content.input),
          });
        }
      }
    }

    return {
      text,
      toolCalls,
      finishReason: mapAnthropicStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      responseId: undefined,
      responseModelId: undefined,
      rawRequest: { prompt: rawPrompt, settings: rawSettings },
      rawResponse: { headers: responseHeaders },
      warnings,
    };
  }

  async doStream(
    options: Parameters<LanguageModelV2['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    const { args, warnings } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/messages`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: {
        ...args,
        stream: true,
      },
      failedResponseHandler: anthropicFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        anthropicMessagesChunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const { messages: rawPrompt, ...rawSettings } = args;

    let finishReason: LanguageModelV2FinishReason = 'unknown';
    const usage: { inputTokens: number; outputTokens: number } = {
      inputTokens: Number.NaN,
      outputTokens: Number.NaN,
    };

    const toolCallContentBlocks: Record<
      number,
      {
        toolCallId: string;
        toolName: string;
        jsonText: string;
      }
    > = {};

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof anthropicMessagesChunkSchema>>,
          LanguageModelV2StreamChunk
        >({
          transform(chunk, controller) {
            if (!chunk.success) {
              controller.enqueue({ type: 'error', error: chunk.error });
              return;
            }

            const value = chunk.value;

            switch (value.type) {
              case 'ping': {
                return; // ignored
              }

              case 'content_block_start': {
                const contentBlockType = value.content_block.type;

                switch (contentBlockType) {
                  case 'text': {
                    return; // ignored
                  }

                  case 'tool_use': {
                    toolCallContentBlocks[value.index] = {
                      toolCallId: value.content_block.id,
                      toolName: value.content_block.name,
                      jsonText: '',
                    };
                    return;
                  }

                  default: {
                    const _exhaustiveCheck: never = contentBlockType;
                    throw new Error(
                      `Unsupported content block type: ${_exhaustiveCheck}`,
                    );
                  }
                }
              }

              case 'content_block_stop': {
                // when finishing a tool call block, send the full tool call:
                if (toolCallContentBlocks[value.index] != null) {
                  const contentBlock = toolCallContentBlocks[value.index];

                  controller.enqueue({
                    type: 'tool-call',
                    toolCallType: 'function',
                    toolCallId: contentBlock.toolCallId,
                    toolName: contentBlock.toolName,
                    args: contentBlock.jsonText,
                  });

                  delete toolCallContentBlocks[value.index];
                }

                return;
              }

              case 'content_block_delta': {
                const deltaType = value.delta.type;
                switch (deltaType) {
                  case 'text_delta': {
                    controller.enqueue({
                      type: 'text-delta',
                      textDelta: value.delta.text,
                    });

                    return;
                  }

                  case 'input_json_delta': {
                    const contentBlock = toolCallContentBlocks[value.index];

                    controller.enqueue({
                      type: 'tool-call-delta',
                      toolCallType: 'function',
                      toolCallId: contentBlock.toolCallId,
                      toolName: contentBlock.toolName,
                      argsTextDelta: value.delta.partial_json,
                    });

                    contentBlock.jsonText += value.delta.partial_json;

                    return;
                  }

                  default: {
                    const _exhaustiveCheck: never = deltaType;
                    throw new Error(
                      `Unsupported delta type: ${_exhaustiveCheck}`,
                    );
                  }
                }
              }

              case 'message_start': {
                usage.inputTokens = value.message.usage.input_tokens;
                usage.outputTokens = value.message.usage.output_tokens;
                return;
              }

              case 'message_delta': {
                usage.outputTokens = value.usage.output_tokens;
                finishReason = mapAnthropicStopReason(value.delta.stop_reason);
                return;
              }

              case 'message_stop': {
                controller.enqueue({ type: 'finish', finishReason, usage });
                return;
              }

              case 'error': {
                controller.enqueue({ type: 'error', error: value.error });
                return;
              }

              default: {
                const _exhaustiveCheck: never = value;
                throw new Error(`Unsupported chunk type: ${_exhaustiveCheck}`);
              }
            }
          },
        }),
      ),
      rawRequest: { prompt: rawPrompt, settings: rawSettings },
      rawResponse: { headers: responseHeaders },
      warnings,
    };
  }
}

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const anthropicMessagesResponseSchema = z.object({
  type: z.literal('message'),
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
      z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        input: z.unknown(),
      }),
    ]),
  ),
  stop_reason: z.string().optional().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const anthropicMessagesChunkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_start'),
    message: z.object({
      usage: z.object({
        input_tokens: z.number(),
        output_tokens: z.number(),
      }),
    }),
  }),
  z.object({
    type: z.literal('content_block_start'),
    index: z.number(),
    content_block: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
      z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
      }),
    ]),
  }),
  z.object({
    type: z.literal('content_block_delta'),
    index: z.number(),
    delta: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('input_json_delta'),
        partial_json: z.string(),
      }),
      z.object({
        type: z.literal('text_delta'),
        text: z.string(),
      }),
    ]),
  }),
  z.object({
    type: z.literal('content_block_stop'),
    index: z.number(),
  }),
  z.object({
    type: z.literal('error'),
    error: z.object({
      type: z.string(),
      message: z.string(),
    }),
  }),
  z.object({
    type: z.literal('message_delta'),
    delta: z.object({ stop_reason: z.string().optional().nullable() }),
    usage: z.object({ output_tokens: z.number() }),
  }),
  z.object({
    type: z.literal('message_stop'),
  }),
  z.object({
    type: z.literal('ping'),
  }),
]);

function prepareToolsAndToolChoice({
  tools,
  toolChoice,
}: {
  tools: LanguageModelV2FunctionTool[] | undefined;
  toolChoice: LanguageModelV2ToolChoice | undefined;
}) {
  // when the tools array is empty, change it to undefined to prevent errors:
  tools = tools?.length ? tools : undefined;

  if (tools == null) {
    return { tools: undefined, tool_choice: undefined };
  }

  const mappedTools = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));

  if (toolChoice == null) {
    return { tools: mappedTools, tool_choice: undefined };
  }

  const type = toolChoice.type;

  switch (type) {
    case 'auto':
      return { tools: mappedTools, tool_choice: { type: 'auto' } };
    case 'required':
      return { tools: mappedTools, tool_choice: { type: 'any' } };
    case 'none':
      // Anthropic does not support 'none' tool choice, so we remove the tools:
      return { tools: undefined, tool_choice: undefined };
    case 'tool':
      return {
        tools: mappedTools,
        tool_choice: { type: 'tool', name: toolChoice.toolName },
      };
    default: {
      const _exhaustiveCheck: never = type;
      throw new Error(`Unsupported tool choice type: ${_exhaustiveCheck}`);
    }
  }
}
