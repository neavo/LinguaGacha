const MODEL_TYPE_VALUES = ["PRESET", "CUSTOM_GOOGLE", "CUSTOM_OPENAI", "CUSTOM_ANTHROPIC"] as const;

const MODEL_THINKING_LEVEL_VALUES = ["OFF", "LOW", "MEDIUM", "HIGH"] as const;

export type ModelType = (typeof MODEL_TYPE_VALUES)[number];

export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVEL_VALUES)[number];

export type ModelRequestSnapshot = {
  extra_headers: Record<string, string>;
  extra_headers_custom_enable: boolean;
  extra_body: Record<string, unknown>;
  extra_body_custom_enable: boolean;
};

export type ModelThresholdSnapshot = {
  input_token_limit: number;
  output_token_limit: number;
  rpm_limit: number;
  concurrency_limit: number;
};

export type ModelThinkingSnapshot = {
  level: ModelThinkingLevel;
};

export type ModelGenerationSnapshot = {
  temperature: number;
  temperature_custom_enable: boolean;
  top_p: number;
  top_p_custom_enable: boolean;
  presence_penalty: number;
  presence_penalty_custom_enable: boolean;
  frequency_penalty: number;
  frequency_penalty_custom_enable: boolean;
};

export type ModelEntrySnapshot = {
  id: string;
  type: ModelType;
  name: string;
  api_format: string;
  api_url: string;
  api_key: string;
  model_id: string;
  request: ModelRequestSnapshot;
  threshold: ModelThresholdSnapshot;
  thinking: ModelThinkingSnapshot;
  generation: ModelGenerationSnapshot;
};

export type ModelPageSnapshot = {
  active_model_id: string;
  models: ModelEntrySnapshot[];
};

export type ModelDialogState =
  | { kind: null; model_id: null }
  | { kind: "basic"; model_id: string }
  | { kind: "task"; model_id: string }
  | { kind: "advanced"; model_id: string };

export type ModelConfirmState =
  | { kind: null; model_id: null }
  | { kind: "delete"; model_id: string }
  | { kind: "reset"; model_id: string };

export type ModelSelectorState = {
  open: boolean;
  model_id: string | null;
  available_models: string[];
  filter_text: string;
  is_loading: boolean;
};

export type ModelCategorySnapshot = {
  type: ModelType;
  title: string;
  description: string;
  accent_color: string;
  can_add: boolean;
  models: ModelEntrySnapshot[];
};

type ModelTestKeyResult = {
  masked_key: string;
  success: boolean;
  input_tokens: number;
  output_tokens: number;
  response_time_ms: number;
  error_reason: string;
};

export type ModelTestResult = {
  success: boolean;
  result_msg: string;
  total_count: number;
  success_count: number;
  failure_count: number;
  total_response_time_ms: number;
  key_results: ModelTestKeyResult[];
};
