import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import type { ApiJsonValue } from "../../api/api-types";
import type { LLMMessage } from "../llm-types";

export type RequestProvider = "openai-compatible" | "google" | "anthropic" | "sakura";
export type RequestResponseMode = "chat-stream" | "sakura-lines";

export interface ModelRequestSnapshot {
  provider: RequestProvider;
  api_format: ModelApiFormat;
  api_keys: string[];
  base_url: string;
  model_id: string;
  headers: Record<string, string>;
  extra_body: Record<string, ApiJsonValue>;
  generation: Record<string, ApiJsonValue>;
  output_token_limit: number;
  thinking_level: ModelThinkingLevel;
}

export interface ResolvedRequestPolicy {
  provider: RequestProvider; // provider 决定 official SDK transport，不能再由 transport 二次推断
  api_format: ModelApiFormat;
  base_url: string;
  model_id: string;
  headers: Record<string, string>;
  api_keys: string[];
  messages: LLMMessage[];
  payload: Record<string, unknown>;
  timeout_ms: number;
  response_mode: RequestResponseMode;
  diagnostics: Record<string, ApiJsonValue>;
}
