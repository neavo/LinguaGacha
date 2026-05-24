import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../../api/api-types";
import type { LLMRequestBody, LLMClientPort, LLMRequestResult } from "../../llm/llm-types";
import { AnalysisWorkUnitRunner } from "./runners/analysis-runner";
import { TranslationWorkUnitRunner } from "./runners/translation-runner";
import { WorkUnitRunner } from "./work-unit-runner";

describe("work-unit runner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("翻译 runner 执行预处理、LLM 调用、响应解码和 item 回写", async () => {
    const app_root = await create_template_root();
    const captured_requests: LLMRequestBody[] = [];
    const runner = new TranslationWorkUnitRunner(
      app_root,
      create_llm_client(captured_requests, {
        response_result: '{"0":"你好"}',
        input_tokens: 4,
        output_tokens: 5,
      }),
    );

    const result = await runner.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "translation",
        model: { api_format: "OpenAI" },
        config_snapshot: create_config_payload(),
        quality_snapshot: create_quality_payload(),
        payload: {
          items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
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
    expect(result.output.row_count).toBe(1);
    expect(captured_requests[0]?.messages[1]?.content).toContain("こんにちは");
  });

  it("翻译日志的请求用时覆盖 LLM 等待时间", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));
    const app_root = await create_template_root();
    const runner = new TranslationWorkUnitRunner(app_root, {
      request: async () => {
        vi.setSystemTime(new Date(3500));
        return {
          response_think: "",
          response_result: '{"0":"你好"}',
          input_tokens: 4,
          output_tokens: 5,
          cancelled: false,
          timeout: false,
          degraded: false,
        };
      },
    });

    const result = await runner.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "translation",
        model: { api_format: "OpenAI" },
        config_snapshot: create_config_payload(),
        quality_snapshot: create_quality_payload(),
        payload: {
          items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
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

    expect(result.logs[0]?.message).toContain(
      "任务耗时 2.50 秒，文本行数 1 行，输入消耗 4 Tokens，输出消耗 5 Tokens",
    );
  });

  it("翻译日志分离模型思考过程、规则分析和翻译结果", async () => {
    const app_root = await create_template_root();
    const runner = new TranslationWorkUnitRunner(
      app_root,
      create_llm_client([], {
        response_think: "真实思考链",
        response_result: '<why>[核心约束]：保持行数</why>\n{"0":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "translation",
        model: { api_format: "OpenAI" },
        config_snapshot: create_config_payload(),
        quality_snapshot: create_quality_payload(),
        payload: {
          items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
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

    const message = String(result.logs[0]?.message ?? "");
    expect(message.startsWith("\n")).toBe(false);
    expect(message).toContain("思考过程：\n真实思考链");
    expect(message).toContain("规则分析：\n[核心约束]：保持行数");
    expect(message).toContain('翻译结果：\n{"0":"你好"}');
    expect(message).not.toContain("模型思考内容");
  });

  it("LLM 请求失败时翻译日志只在结构化字段保留调用栈", async () => {
    const app_root = await create_template_root();
    const runner = new TranslationWorkUnitRunner(
      app_root,
      create_llm_client([], {
        failure: {
          name: "ProviderError",
          message: "供应商爆炸",
          stack: "ProviderError: 供应商爆炸\n    at request",
          context: {
            provider: "openai-compatible",
          },
        },
      }),
    );

    const result = await runner.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "translation",
        model: { api_format: "OpenAI" },
        config_snapshot: create_config_payload(),
        quality_snapshot: create_quality_payload(),
        payload: {
          items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
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

    expect(result.outcome).toBe("failed");
    expect(result.logs[0]).toMatchObject({
      level: "error",
      error_message: "供应商爆炸",
      stack: "ProviderError: 供应商爆炸\n    at request",
      context: {
        provider: "openai-compatible",
        error_name: "ProviderError",
      },
    });
    expect(result.logs[0]?.message).toContain("模型请求失败");
    expect(result.logs[0]?.message).not.toContain("ProviderError: 供应商爆炸");
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

    const result = await runner.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "analysis",
        model: {},
        config_snapshot: create_config_payload({ source_language: "EN" }),
        quality_snapshot: create_quality_payload(),
        payload: {
          file_path: "demo.txt",
          items: [
            {
              item_id: 1,
              file_path: "demo.txt",
              src_text: "Alice",
              first_name_src: null,
            },
          ],
        },
        diagnostics: {
          retry_count: 0,
        },
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      outcome: "success",
      metrics: {
        input_tokens: 2,
        output_tokens: 3,
      },
    });
    if (result.output.kind !== "analysis") {
      throw new Error("期望分析输出");
    }
    expect(result.output.glossary_entries).toEqual([
      {
        src: "Alice",
        dst: "爱丽丝",
        info: "女性人名",
        case_sensitive: false,
      },
    ]);
  });

  it("分析日志按思考过程、规则分析、分析输入和分析结果分段", async () => {
    const app_root = await create_template_root();
    const runner = new AnalysisWorkUnitRunner(
      app_root,
      create_llm_client([], {
        response_think: "分析思考链",
        response_result:
          '<why>[难点处理]：Alice -> 女性人名</why>\n{"src":"Alice","dst":"爱丽丝","type":"女性人名"}',
      }),
    );

    const result = await runner.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "analysis",
        model: {},
        config_snapshot: create_config_payload({ source_language: "EN" }),
        quality_snapshot: create_quality_payload(),
        payload: {
          file_path: "demo.txt",
          items: [
            {
              item_id: 1,
              file_path: "demo.txt",
              src_text: "Alice",
              first_name_src: null,
            },
          ],
        },
        diagnostics: {
          retry_count: 0,
        },
      },
      new AbortController().signal,
    );

    const message = String(result.logs[0]?.message ?? "");
    expect(message.startsWith("\n")).toBe(false);
    expect(message.indexOf("思考过程：")).toBeLessThan(message.indexOf("规则分析："));
    expect(message.indexOf("规则分析：")).toBeLessThan(message.indexOf("分析输入："));
    expect(message.indexOf("分析输入：")).toBeLessThan(message.indexOf("分析结果："));
    expect(message).toContain("规则分析：\n[难点处理]：Alice -> 女性人名");
    expect(message).toContain("分析输入：\nSRC: Alice");
    expect(message).toContain("分析结果：\nTERM: Alice -> 爱丽丝 #女性人名");
    expect(message).not.toContain("模型回复内容");
  });

  it("统一分发器执行单条翻译工具调用", async () => {
    const runner = new WorkUnitRunner({
      appRoot: await create_template_root(),
    });

    await expect(
      runner.translate_single(
        {
          run_id: "run-1",
          work_unit_id: "single",
          task_type: "translate-single",
          model: {},
          config_snapshot: create_config_payload(),
          quality_snapshot: create_quality_payload(),
          text: "",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("request.validation_failed");
  });
});

/**
 * 构造内存版 LLM client，捕获请求体以验证 runner 没有绕过协议边界
 */
function create_llm_client(
  captured_requests: LLMRequestBody[],
  overrides: Partial<LLMRequestResult>,
): LLMClientPort {
  return {
    request: async (body: LLMRequestBody) => {
      captured_requests.push(body);
      return {
        response_think: "",
        response_result: "",
        input_tokens: 0,
        output_tokens: 0,
        cancelled: false,
        timeout: false,
        degraded: false,
        ...overrides,
      };
    },
  };
}

/**
 * 生成 work unit 使用的最小配置快照，用例通过 overrides 调整单点行为
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
 * 生成默认关闭质量规则的运行态 payload，避免无关规则影响 runner 断言
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
 * 创建临时模板根目录，保证测试不读取开发机真实资源文件
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-runner-"));
  await write_template(app_root, "translation_prompt", "zh");
  await write_template(app_root, "analysis_prompt", "zh");
  return app_root;
}

/**
 * 写入最小模板文件集合，覆盖 PromptBuilder 的固定读取契约
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
