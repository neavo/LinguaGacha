import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../../../api/api-types";
import { TranslationWorkUnitRunner } from "./translation-runner";
import type { LLMClientPort, LLMRequestBody } from "../../../llm/llm-types";
import type { TranslationWorkUnit } from "../../protocol/work-unit";

/**
 * 构造无条目的翻译 work unit，验证 runner 不会为无效 chunk 请求模型。
 */
function create_empty_translation_unit(): TranslationWorkUnit {
  return {
    kind: "translation",
    unit_id: "translation-unit-1",
    run_id: "run-1",
    model: {},
    config_snapshot: {},
    quality_snapshot: {},
    payload: {
      items: [],
      precedings: [],
    },
    diagnostics: {
      token_threshold: 0,
      split_count: 1,
      retry_count: 0,
      is_initial: true,
    },
  };
}

describe("TranslationWorkUnitRunner", () => {
  it("没有可翻译条目时返回 failed 空结果且不请求 LLM", async () => {
    const llm_client: LLMClientPort = {
      request: vi.fn(),
    };
    const runner = new TranslationWorkUnitRunner(process.cwd(), llm_client);

    await expect(
      runner.execute_unit(create_empty_translation_unit(), new AbortController().signal),
    ).resolves.toMatchObject({
      unit_id: "translation-unit-1",
      kind: "translation",
      outcome: "failed",
      metrics: {
        input_tokens: 0,
        output_tokens: 0,
      },
      output: {
        kind: "translation",
        items: [],
        row_count: 0,
      },
      logs: [],
    });
    expect(llm_client.request).not.toHaveBeenCalled();
  });

  it("SakuraLLM 含姓名请求仍走固定纯文本提示词且不写姓名译文", async () => {
    const captured_requests: LLMRequestBody[] = [];
    const llm_client: LLMClientPort = {
      request: vi.fn(async (body: LLMRequestBody) => {
        captured_requests.push(body);
        return {
          response_think: "",
          response_result: '{"0":"你好"}',
          input_tokens: 1,
          output_tokens: 1,
          cancelled: false,
          timeout: false,
          degraded: false,
        };
      }),
    };
    const runner = new TranslationWorkUnitRunner(await create_template_root(), llm_client);

    const result = await runner.execute_unit(
      {
        kind: "translation",
        unit_id: "translation-unit-1",
        run_id: "run-1",
        model: { api_format: "SakuraLLM" },
        config_snapshot: create_config_payload(),
        quality_snapshot: create_quality_payload(),
        payload: {
          items: [
            {
              id: 1,
              src: "こんにちは",
              name_src: "虎鉄",
              dst: "",
              status: "NONE",
              text_type: "TXT",
            },
          ],
          precedings: [],
        },
        diagnostics: {
          token_threshold: 512,
          split_count: 0,
          retry_count: 0,
          is_initial: true,
        },
      },
      new AbortController().signal,
    );

    if (result.output.kind !== "translation") {
      throw new Error("期望翻译输出");
    }
    expect(captured_requests[0]?.messages[1]?.content).toBe(
      "将下面的日文文本翻译成中文：\nこんにちは",
    );
    expect(result.output.items).toEqual([
      {
        id: 1,
        src: "こんにちは",
        name_src: "虎鉄",
        dst: "你好",
        status: "PROCESSED",
        text_type: "TXT",
      },
    ]);
  });
});

/**
 * 构造 runner 所需配置快照，字段名对齐任务启动载荷。
 */
function create_config_payload(): Record<string, ApiJsonValue> {
  return {
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    check_kana_residue: true,
    check_hangeul_residue: true,
    check_similarity: true,
    auto_process_prefix_suffix_preserved_text: true,
  };
}

/**
 * 构造关闭高级规则的质量快照，避免单测依赖真实项目质量设置。
 */
function create_quality_payload(): Record<string, ApiJsonValue> {
  return {
    quality: {
      glossary: { enabled: false, entries: [] },
      text_preserve: { mode: "OFF", entries: [] },
      pre_replacement: { enabled: false, entries: [] },
      post_replacement: { enabled: false, entries: [] },
    },
    prompts: {
      translation: { enabled: false, text: "" },
      analysis: { enabled: false, text: "" },
    },
  };
}

/**
 * 构造临时提示词资源根，覆盖 SakuraLLM 专用提示词路径。
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-translation-runner-"));
  const dir = path.join(app_root, "resource", "translation_prompt", "template", "zh");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "prefix.txt"), "前缀", "utf-8");
  await writeFile(path.join(dir, "base.txt"), "从 {source_language} 到 {target_language}", "utf-8");
  await writeFile(path.join(dir, "thinking.txt"), "", "utf-8");
  await writeFile(
    path.join(dir, "suffix.txt"),
    "输出 JSONLINE\n{translation_output_format}",
    "utf-8",
  );
  return app_root;
}
