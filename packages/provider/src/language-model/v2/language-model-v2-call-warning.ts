/**
Warning from the model provider for this call. The call will proceed, but e.g.
some settings might not be supported, which can lead to suboptimal results.
 */
export type LanguageModelV2CallWarning =
  | {
      type: 'unsupported-setting';
      setting: string;
      details?: string;
    }
  | {
      type: 'other';
      message: string;
    };
