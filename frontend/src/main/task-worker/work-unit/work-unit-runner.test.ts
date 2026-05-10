import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ApiJsonValue } from "../../api/api-types";
import type { PyLlmRequestClient } from "../llm/py-llm-request-client";
import type { PyLlmRequestBody, PyLlmRequestResult } from "../llm/llm-request-types";
import { AnalysisWorkUnitRunner } from "./analysis-work-unit-runner";
import { TranslationWorkUnitRunner } from "./translation-work-unit-runner";
import { WorkUnitRunner } from "./work-unit-runner";

describe("work-unit runner", () => {
  it("翻译 runner 执行预处理、LLM 调用、响应解码和 item 回写", async () => {
    const app_root = await create_template_root();
    const captured_requests: PyLlmRequestBody[] = [];
    const runner = new TranslationWorkUnitRunner(
      app_root,
      create_llm_client(captured_requests, {
        response_result: '{"0":"你好"}',
        input_tokens: 4,
        output_tokens: 5,
      }),
    );

    const result = await runner.execute_translation_chunk(
      {
        run_id: "run-1",
        work_unit_id: "unit-1",
        task_type: "translation",
        model: { api_format: "OpenAI" },
        config_snapshot: create_config_payload(),
        quality_snapshot: create_quality_payload(),
        items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
      },
      new AbortController().signal,
    );

    expect(result.row_count).toBe(1);
    expect(result.items[0]?.dst).toBe("你好");
    expect(result.items[0]?.status).toBe("PROCESSED");
    expect(captured_requests[0]?.messages[1]?.content).toContain("こんにちは");
  });

  it("分析 runner 归一模型术语候选", async () => {
    const app_root = await create_template_root();
    const runner = new AnalysisWorkUnitRunner(
      app_root,
      create_llm_client([], {
        response_result: '{"src":"Alice","dst":"爱丽丝","type":"女性人名"}',
        input_tokens: 2,
        output_tokens: 3,
      }),
    );

    const result = await runner.execute_analysis_chunk(
      {
        run_id: "run-1",
        work_unit_id: "unit-1",
        task_type: "analysis",
        model: {},
        config_snapshot: create_config_payload({ source_language: "EN" }),
        quality_snapshot: create_quality_payload(),
        context: {
          file_path: "demo.txt",
          retry_count: 0,
          items: [
            {
              item_id: 1,
              file_path: "demo.txt",
              src_text: "Alice",
              first_name_src: null,
            },
          ],
        },
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      success: true,
      input_tokens: 2,
      output_tokens: 3,
    });
    expect(result.glossary_entries).toEqual([
      {
        src: "Alice",
        dst: "爱丽丝",
        info: "女性人名",
        case_sensitive: false,
      },
    ]);
  });

  it("统一分发器拒绝未知 work-unit 方法", async () => {
    const runner = new WorkUnitRunner({
      appRoot: await create_template_root(),
      pyCoreBaseUrl: "http://127.0.0.1:1234",
      pyCoreToken: "token-1",
    });

    await expect(runner.run("missing", {}, new AbortController().signal)).rejects.toThrow(
      "未知 work-unit 方法",
    );
  });
});

/**
 * 构造内存版 LLM client，捕获请求体以验证 runner 没有绕过协议边界。
 */
function create_llm_client(
  captured_requests: PyLlmRequestBody[],
  overrides: Partial<PyLlmRequestResult>,
): PyLlmRequestClient {
  return {
    request: async (body: PyLlmRequestBody) => {
      captured_requests.push(body);
      return {
        response_think: "",
        response_result: "",
        input_tokens: 0,
        output_tokens: 0,
        cancelled: false,
        timeout: false,
        degraded: false,
        error: "",
        ...overrides,
      };
    },
  } as unknown as PyLlmRequestClient;
}

/**
 * 生成 work unit 使用的最小配置快照，用例通过 overrides 调整单点行为。
 */
function create_config_payload(
  overrides: Record<string, ApiJsonValue> = {},
): Record<string, ApiJsonValue> {
  return {
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    check_kana_residue: true,
    check_hangeul_residue: true,
    check_similarity: true,
    auto_process_prefix_suffix_preserved_text: true,
    ...overrides,
  };
}

/**
 * 生成默认关闭质量规则的运行态 payload，避免无关规则影响 runner 断言。
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
 * 创建临时模板根目录，保证测试不读取开发机真实资源文件。
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-runner-"));
  await write_template(app_root, "translation_prompt", "zh");
  await write_template(app_root, "analysis_prompt", "zh");
  return app_root;
}

/**
 * 写入最小模板文件集合，覆盖 PromptBuilder 的固定读取契约。
 */
async function write_template(
  app_root: string,
  task_dir_name: string,
  language: "zh" | "en",
): Promise<void> {
  const dir = path.join(app_root, "resource", task_dir_name, "template", language);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "prefix.txt"), "前缀", "utf-8");
  await writeFile(path.join(dir, "base.txt"), "从 {source_language} 到 {target_language}", "utf-8");
  await writeFile(path.join(dir, "thinking.txt"), "", "utf-8");
  await writeFile(path.join(dir, "suffix.txt"), "输出 JSONLINE", "utf-8");
}
