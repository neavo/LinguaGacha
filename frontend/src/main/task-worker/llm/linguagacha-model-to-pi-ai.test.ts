import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  collect_api_keys,
  convert_linguagacha_model_to_pi_ai,
  get_primary_api_key,
  normalize_api_url,
} from "./linguagacha-model-to-pi-ai";

describe("convert_linguagacha_model_to_pi_ai", () => {
  it("把 OpenAI-compatible 模型快照转换为 pi-ai 模型和本地策略上下文", async () => {
    const app_root = await create_app_root();

    const snapshot = convert_linguagacha_model_to_pi_ai(
      {
        api_format: "OpenAI",
        api_key: " key-1 \n key-2 ",
        api_url: "https://example.com/v1/chat/completions/",
        model_id: "gpt-5-mini",
        name: "GPT 5 Mini",
        request: {
          extra_headers_custom_enable: true,
          extra_headers: { "X-Test": "yes" },
          extra_body_custom_enable: true,
          extra_body: { custom: true },
        },
        threshold: { input_token_limit: 8192, output_token_limit: -1 },
        thinking: { level: "HIGH" },
        generation: { temperature_custom_enable: true, temperature: 0.2 },
      },
      app_root,
    );

    expect(snapshot.api_keys).toEqual(["key-1", "key-2"]);
    expect(snapshot.api_url).toBe("https://example.com/v1");
    expect(snapshot.extra_body).toEqual({ custom: true });
    expect(snapshot.extra_headers).toMatchObject({
      "User-Agent": "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)",
      "X-Test": "yes",
    });
    expect(snapshot.pi_model).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      contextWindow: 8192,
      id: "gpt-5-mini",
      maxTokens: 4096,
      name: "GPT 5 Mini",
      provider: "openai",
      reasoning: true,
    });
    expect(snapshot.thinking_level).toBe("HIGH");
  });

  it("映射 Google 与 Anthropic 的 pi-ai API 类型", async () => {
    const app_root = await create_app_root();

    const google = convert_linguagacha_model_to_pi_ai(
      { api_format: "Google", api_key: "g-key", model_id: "gemini-2.5-flash" },
      app_root,
    );
    const anthropic = convert_linguagacha_model_to_pi_ai(
      { api_format: "Anthropic", api_key: "a-key", model_id: "claude-sonnet-4-5" },
      app_root,
    );

    expect(google.pi_model.api).toBe("google-generative-ai");
    expect(google.pi_model.provider).toBe("google");
    expect(anthropic.pi_model.api).toBe("anthropic-messages");
    expect(anthropic.pi_model.provider).toBe("anthropic");
  });
});

describe("LLM 模型工具函数", () => {
  it("归一多行 key 与 OpenAI-compatible URL", () => {
    expect(collect_api_keys(" a \n\n b ")).toEqual(["a", "b"]);
    expect(collect_api_keys("")).toEqual(["no_key_required"]);
    expect(get_primary_api_key(" first \n second ")).toBe("first");
    expect(normalize_api_url("https://host/v1/chat/completions/", "SakuraLLM")).toBe(
      "https://host/v1",
    );
  });
});

/**
 * 创建只含 version.txt 的最小 appRoot，确保 User-Agent 断言稳定。
 */
async function create_app_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-model-convert-"));
  await writeFile(path.join(app_root, "version.txt"), "1.2.3", "utf-8");
  return app_root;
}
