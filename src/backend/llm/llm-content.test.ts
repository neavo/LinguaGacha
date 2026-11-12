import { describe, expect, it } from "vitest";
import { apply_message_content } from "./llm-content";
import type { LLMMessage } from "./llm-types";

describe("媒体消息编码", () => {
  it.each(["OpenAI", "OpenAIResponses", "Google", "Anthropic", "SakuraLLM"] as const)(
    "%s 保留混合内容顺序、媒体字节与系统指令",
    (api_format) => {
      const messages: LLMMessage[] = [
        { role: "system", content: "system instruction" },
        {
          role: "user",
          content: [
            { type: "text", text: "before" },
            { type: "audio", mime_type: "audio/mpeg", data: "YWJj" },
            { type: "video", mime_type: "video/mp4", data: "ZGVm" },
            { type: "image", mime_type: "image/png", data: "Z2hp" },
            { type: "text", text: "after" },
          ],
        },
        { role: "user", content: "last" },
      ];
      const system = {
        role: api_format === "OpenAIResponses" ? "developer" : "system",
        content: "system instruction",
      };
      const payload = apply_message_content(
        {
          input: [system],
          messages: [system],
          system: [{ type: "text", text: "system instruction" }],
        },
        api_format,
        messages,
      ) as Record<string, unknown>;
      if (api_format === "Google") {
        expect(payload["contents"]).toEqual([
          { role: "user", parts: [{ text: "system instruction" }] },
          {
            role: "user",
            parts: [
              { text: "before" },
              { inlineData: { mimeType: "audio/mpeg", data: "YWJj" } },
              { inlineData: { mimeType: "video/mp4", data: "ZGVm" } },
              { inlineData: { mimeType: "image/png", data: "Z2hp" } },
              { text: "after" },
            ],
          },
          { role: "user", parts: [{ text: "last" }] },
        ]);
      } else {
        const field = api_format === "OpenAIResponses" ? "input" : "messages";
        const messages = payload[field] as { role: string; content: unknown }[];
        const users = messages.filter((message) => message.role === "user");
        const parts =
          api_format === "Anthropic"
            ? [
                { type: "text", text: "before" },
                {
                  type: "audio",
                  source: { type: "base64", media_type: "audio/mpeg", data: "YWJj" },
                },
                {
                  type: "video",
                  source: { type: "base64", media_type: "video/mp4", data: "ZGVm" },
                },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: "Z2hp" },
                },
                { type: "text", text: "after" },
              ]
            : api_format === "OpenAIResponses"
              ? [
                  { type: "input_text", text: "before" },
                  { type: "input_audio", input_audio: { data: "YWJj", format: "mp3" } },
                  { type: "input_video", video_url: "data:video/mp4;base64,ZGVm" },
                  { type: "input_image", image_url: "data:image/png;base64,Z2hp" },
                  { type: "input_text", text: "after" },
                ]
              : [
                  { type: "text", text: "before" },
                  { type: "input_audio", input_audio: { data: "YWJj", format: "mp3" } },
                  { type: "video_url", video_url: { url: "data:video/mp4;base64,ZGVm" } },
                  { type: "image_url", image_url: { url: "data:image/png;base64,Z2hp" } },
                  { type: "text", text: "after" },
                ];
        expect(users[0]?.content).toEqual(parts);
        expect(users).toHaveLength(2);
        if (api_format === "Anthropic")
          expect(payload["system"]).toEqual([{ type: "text", text: "system instruction" }]);
        else
          expect(messages[0]).toEqual({
            role: api_format === "OpenAIResponses" ? "developer" : "system",
            content: "system instruction",
          });
      }
    },
  );

  it.each(["OpenAI", "OpenAIResponses"] as const)("%s 将 MP4 音频编码为 m4a", (format) => {
    const field = format === "OpenAIResponses" ? "input" : "messages";
    expect(
      apply_message_content({ [field]: [] }, format, [
        { role: "user", content: [{ type: "audio", mime_type: "audio/mp4", data: "YWJj" }] },
      ]),
    ).toEqual({
      [field]: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: "YWJj", format: "m4a" } }],
        },
      ],
    });
  });
});
