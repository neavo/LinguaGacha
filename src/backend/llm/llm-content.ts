import { is_json_record } from "../../domain/json";
import type { ModelApiFormat } from "../../domain/model";
import type { ModelRequestPolicy } from "./llm-overrides";
import type { LLMContent, LLMMessage } from "./llm-types";

/** 协议格式名与 MIME 子类型不同。其余扩展交给服务端校验。 */
const AUDIO_FORMATS: Readonly<Record<string, string>> = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a", // https://docs.volcengine.com/docs/ark/chat-api
});

/** Pi 的消息类型只支持文字和图片。`onPayload` 在 SDK 编码后补齐音视频。 */
export function apply_message_content(
  payload: unknown,
  format: ModelApiFormat,
  messages: LLMMessage[],
  policy?: ModelRequestPolicy,
): unknown {
  if (!messages.some((message) => Array.isArray(message.content))) return payload;
  if (!is_json_record(payload)) throw new Error("Invalid model payload.");
  const users = messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      role: "user",
      content: (typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content
      ).map((part) => encode_content(part, format, policy)),
    }));
  if (format === "Google") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n\n");
    return {
      ...payload,
      contents: [
        ...(system ? [{ role: "user", parts: [{ text: system }] }] : []),
        ...users.map((message) => ({ role: message.role, parts: message.content })),
      ],
    };
  }
  const field = format === "OpenAIResponses" ? "input" : "messages";
  const original = payload[field];
  if (!Array.isArray(original)) throw new Error(`Invalid model payload: ${field}.`);
  // 保留 SDK 生成的指令消息，只替换本次 OneShot 的用户消息。
  return {
    ...payload,
    [field]: [
      ...original.filter(
        (message) =>
          is_json_record(message) &&
          (message["role"] === "system" || message["role"] === "developer"),
      ),
      ...users,
    ],
  };
}

/** 媒体扩展按协议形状发送，是否支持交给服务端，不按模型目录预判。 */
function encode_content(
  part: LLMContent,
  format: ModelApiFormat,
  policy?: ModelRequestPolicy,
): Record<string, unknown> {
  if (part.type === "text")
    return format === "Google"
      ? { text: part.text }
      : {
          type: format === "OpenAIResponses" ? "input_text" : "text",
          text: part.text,
        };
  if (format === "Google") return { inlineData: { mimeType: part.mime_type, data: part.data } };
  // Messages 的媒体扩展沿用 `source` 结构。是否支持由服务端决定。
  if (format === "Anthropic")
    return {
      type: part.type,
      source: { type: "base64", media_type: part.mime_type, data: part.data },
    };
  const url = `data:${part.mime_type};base64,${part.data}`;
  const audio_format = AUDIO_FORMATS[part.mime_type] ?? part.mime_type.slice("audio/".length);
  if (format === "OpenAIResponses") {
    if (part.type === "image") return { type: "input_image", image_url: url };
    if (part.type === "video") return { type: "input_video", video_url: url };
    if (policy?.responses_audio_format === "audio_url")
      return { type: "input_audio", audio_url: url };
    if (policy?.responses_audio_format === "data_uri")
      return { type: "input_audio", data: url, format: audio_format };
    // CPA 的 Gemini Responses 音频扩展接受嵌套 input_audio。
    return { type: "input_audio", input_audio: { data: part.data, format: audio_format } };
  }
  if (part.type === "audio")
    return { type: "input_audio", input_audio: { data: part.data, format: audio_format } };
  // video_url 为火山与 CPA 接受的 Chat Completions 扩展，不推断其他接入点的支持范围。
  const field = part.type === "image" ? "image_url" : "video_url";
  return { type: field, [field]: { url } };
}
