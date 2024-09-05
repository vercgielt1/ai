import { z } from 'zod';
import {
  ProviderMetadata,
  providerMetadataSchema,
} from '../types/provider-metadata';
import { DataContent, dataContentSchema } from './data-content';

/**
Text content part of a prompt. It contains a string of text.
 */
export interface TextPart {
  type: 'text';

  /**
The text content.
   */
  text: string;

  /**
Additional provider-specific metadata. They are passed through
to the provider from the AI SDK and enable provider-specific
functionality that can be fully encapsulated in the provider.
 */
  experimental_providerMetadata?: ProviderMetadata;
}

export const textPartSchema: z.ZodType<TextPart> = z.object({
  type: z.literal('text'),
  text: z.string(),
  experimental_providerMetadata: providerMetadataSchema.optional(),
});

/**
Image content part of a prompt. It contains an image.
 */
export interface ImagePart {
  type: 'image';

  /**
Image data. Can either be:

- data: a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer
- URL: a URL that points to the image
   */
  image: DataContent | URL;

  /**
Optional mime type of the image.
   */
  mimeType?: string;

  /**
Additional provider-specific metadata. They are passed through
to the provider from the AI SDK and enable provider-specific
functionality that can be fully encapsulated in the provider.
 */
  experimental_providerMetadata?: ProviderMetadata;
}

export const imagePartSchema: z.ZodType<ImagePart> = z.object({
  type: z.literal('image'),
  image: z.union([dataContentSchema, z.instanceof(URL)]),
  mimeType: z.string().optional(),
  experimental_providerMetadata: providerMetadataSchema.optional(),
});

/**
Tool call content part of a prompt. It contains a tool call (usually generated by the AI model).
 */
export interface ToolCallPart {
  type: 'tool-call';

  /**
ID of the tool call. This ID is used to match the tool call with the tool result.
 */
  toolCallId: string;

  /**
Name of the tool that is being called.
 */
  toolName: string;

  /**
Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
   */
  args: unknown;

  /**
Additional provider-specific metadata. They are passed through
to the provider from the AI SDK and enable provider-specific
functionality that can be fully encapsulated in the provider.
 */
  experimental_providerMetadata?: ProviderMetadata;
}

export const toolCallPartSchema: z.ZodType<ToolCallPart> = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
}) as z.ZodType<ToolCallPart>; // necessary bc args is optional on Zod type

/**
Tool result content part of a prompt. It contains the result of the tool call with the matching ID.
 */
export interface ToolResultPart {
  type: 'tool-result';

  /**
ID of the tool call that this result is associated with.
 */
  toolCallId: string;

  /**
Name of the tool that generated this result.
  */
  toolName: string;

  /**
Result of the tool call. This is a JSON-serializable object.
   */
  result: unknown;

  /**
Optional flag if the result is an error or an error message.
   */
  isError?: boolean;

  /**
Additional provider-specific metadata. They are passed through
to the provider from the AI SDK and enable provider-specific
functionality that can be fully encapsulated in the provider.
 */
  experimental_providerMetadata?: ProviderMetadata;
}

export const toolResultPartSchema: z.ZodType<ToolResultPart> = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional(),
  experimental_providerMetadata: providerMetadataSchema.optional(),
}) as z.ZodType<ToolResultPart>; // necessary bc result is optional on Zod type
