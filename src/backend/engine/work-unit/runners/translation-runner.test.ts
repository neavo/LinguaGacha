import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../../../domain/json";
import { TranslationWorkUnitRunner } from "./translation-runner";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../../../llm/llm-types";
import type { TranslationWorkUnit } from "../../protocol/work-unit";

const cleanup_roots: string[] = [];

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
  afterEach(async () => {
    vi.useRealTimers();
    while (cleanup_roots.length > 0) {
      await rm(cleanup_roots.pop()!, { force: true, recursive: true });
    }
  });

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

  it("含姓名请求走完整 pipeline 并分别写回正文和姓名", async () => {
    const captured_requests: LLMRequestBody[] = [];
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client(
        {
          response_result:
            '{"0":{"actor":"虎铁","text":"你好"}}\n{"1":{"actor":null,"text":"旁白译文"}}',
          input_tokens: 4,
          output_tokens: 5,
        },
        captured_requests,
      ),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "OpenAI" },
        items: [
          {
            id: 1,
            src: "こんにちは",
            name_src: "虎鉄",
            dst: "",
            status: "NONE",
            text_type: "TXT",
          },
          {
            id: 2,
            src: "地の文",
            name_src: null,
            name_dst: "既有译名",
            dst: "",
            status: "NONE",
            text_type: "TXT",
          },
        ],
      }),
      new AbortController().signal,
    );

    expect(result.output).toMatchObject({
      kind: "translation",
      row_count: 2,
      items: [
        { id: 1, dst: "你好", name_dst: "虎铁", status: "PROCESSED" },
        { id: 2, dst: "旁白译文", name_dst: "既有译名", status: "PROCESSED" },
      ],
    });
    expect(captured_requests[0]?.messages[1]?.content).toContain(
      '{"0":{"actor":"虎鉄","text":"こんにちは"}}',
    );
    expect(captured_requests[0]?.messages[1]?.content).toContain(
      '{"1":{"actor":null,"text":"地の文"}}',
    );
  });

  it("翻译日志的请求用时覆盖 LLM 等待时间", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));
    const runner = new TranslationWorkUnitRunner(await create_template_root(), {
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
      create_translation_unit({ model: { api_format: "OpenAI" } }),
      new AbortController().signal,
    );

    expect(result.logs[0]?.message).toContain(
      "任务耗时 2.50 秒，文本行数 1 行，输入消耗 4 Tokens，输出消耗 5 Tokens",
    );
  });

  it("翻译日志分离模型思考、规则分析和译文", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_think: "真实思考链",
        response_result: '<why>[核心约束]：保持行数</why>\n{"0":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({ model: { api_format: "OpenAI" } }),
      new AbortController().signal,
    );

    const message = String(result.logs[0]?.message ?? "");
    expect(message).toContain("思考过程：\n真实思考链");
    expect(message).toContain("规则分析：\n[核心约束]：保持行数");
    expect(message).toContain('翻译结果：\n{"0":"你好"}');
  });

  it("LLM 请求失败时只在结构化日志字段保留调用栈", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        request_error: {
          name: "ProviderError",
          message: "供应商爆炸",
          stack: "ProviderError: 供应商爆炸\n    at request",
          context: { provider: "openai-compatible" },
        },
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({ model: { api_format: "OpenAI" } }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(result.logs[0]).toMatchObject({
      level: "error",
      error: {
        name: "ProviderError",
        message: "供应商爆炸",
        stack: "ProviderError: 供应商爆炸\n    at request",
        context: { provider: "openai-compatible" },
      },
    });
    expect(result.logs[0]?.message).not.toContain("ProviderError: 供应商爆炸");
  });

  it("完全无法解析译文时记录数据结构错误", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: "not a json response",
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "OpenAI" },
        src: "こんにちは\n世界",
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(String(result.logs[0]?.message ?? "")).toContain("数据结构错误");
    expect(String(result.logs[0]?.message ?? "")).not.toContain("行数不一致");
  });

  it("部分合法译文无法覆盖请求行时记录行数不一致", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: '{"0":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "SakuraLLM" },
        src: "こんにちは\n世界",
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(String(result.logs[0]?.message ?? "")).toContain("行数不一致");
    expect(String(result.logs[0]?.message ?? "")).not.toContain("数据结构错误");
  });

  it("单条行数不一致达重试阈值时写回 fallback 译文并保留真实日志原因", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: '{"0":" 你好 "}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "SakuraLLM" },
        src: "こんにちは\n世界",
        retry_count: 2,
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("success");
    expect(result.output).toMatchObject({
      kind: "translation",
      row_count: 1,
      items: [
        {
          id: 1,
          src: "こんにちは\n世界",
          dst: "你好\n",
          status: "PROCESSED",
          text_type: "TXT",
          retry_count: 2,
        },
      ],
    });
    expect(String(result.logs[0]?.message ?? "")).toContain("行数不一致");
  });

  it("单条行数不一致未达重试阈值时继续失败并递增重试次数", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: '{"0":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "SakuraLLM" },
        src: "こんにちは\n世界",
        retry_count: 1,
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(result.output).toMatchObject({
      kind: "translation",
      row_count: 0,
      items: [
        {
          id: 1,
          dst: "",
          status: "NONE",
          retry_count: 2,
        },
      ],
    });
  });

  it("多条行数不一致达重试阈值时不混写 fallback", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: '{"0":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "SakuraLLM" },
        items: [
          {
            id: 1,
            src: "こんにちは",
            dst: "",
            status: "NONE",
            text_type: "TXT",
            retry_count: 2,
          },
          {
            id: 2,
            src: "世界",
            dst: "",
            status: "NONE",
            text_type: "TXT",
            retry_count: 2,
          },
        ],
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(result.output).toMatchObject({
      kind: "translation",
      row_count: 0,
      items: [
        { id: 1, dst: "", status: "NONE", retry_count: 2 },
        { id: 2, dst: "", status: "NONE", retry_count: 2 },
      ],
    });
    expect(String(result.logs[0]?.message ?? "")).toContain("行数不一致");
  });

  it("完全无法解析译文即使达重试阈值也不写 fallback", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: "not a json response",
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "OpenAI" },
        src: "こんにちは",
        retry_count: 2,
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(result.output).toMatchObject({
      kind: "translation",
      row_count: 0,
      items: [
        {
          id: 1,
          dst: "",
          status: "NONE",
          retry_count: 3,
        },
      ],
    });
    expect(String(result.logs[0]?.message ?? "")).toContain("数据结构错误");
  });

  it("已对齐逐行质量失败达重试阈值时提交译文但日志保留空行原因", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: '{"0":"你好","1":""}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "SakuraLLM" },
        src: "こんにちは\n世界",
        retry_count: 2,
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("success");
    expect(result.output).toMatchObject({
      kind: "translation",
      row_count: 1,
      items: [
        {
          id: 1,
          dst: "你好\n",
          status: "PROCESSED",
          retry_count: 2,
        },
      ],
    });
    expect(String(result.logs[0]?.message ?? "")).toContain("存在空行");
  });
});

/**
 * 构造 runner 所需配置快照，字段名对齐任务启动载荷。
 */
function create_config_payload(): JsonRecord {
  return {
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
  };
}

/**
 * 构造关闭高级规则的质量快照，避免单测依赖真实项目质量设置。
 */
function create_quality_payload(): JsonRecord {
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
 * 构造可覆盖响应字段的 LLM 边界 stub，测试只断言 runner 公开结果。
 */
function create_llm_client(
  overrides: Partial<LLMRequestResult>,
  captured_requests: LLMRequestBody[] = [],
): LLMClientPort {
  return {
    request: async (body) => {
      captured_requests.push(body);
      return {
        response_think: "",
        response_result: "",
        input_tokens: 1,
        output_tokens: 1,
        cancelled: false,
        timeout: false,
        degraded: false,
        ...overrides,
      };
    },
  };
}

/**
 * 构造单条或多条翻译 work unit，便于测试 retry_count 和 chunk 形状差异。
 */
function create_translation_unit(args: {
  model: JsonRecord;
  src?: string;
  retry_count?: number;
  items?: Array<JsonRecord>;
}): TranslationWorkUnit {
  return {
    kind: "translation",
    unit_id: "translation-unit-1",
    run_id: "run-1",
    model: args.model,
    config_snapshot: create_config_payload(),
    quality_snapshot: create_quality_payload(),
    payload: {
      items: args.items ?? [
        {
          id: 1,
          src: args.src ?? "こんにちは",
          dst: "",
          status: "NONE",
          text_type: "TXT",
          ...(args.retry_count === undefined ? {} : { retry_count: args.retry_count }),
        },
      ],
      precedings: [],
    },
    diagnostics: {
      token_threshold: 512,
      split_count: 0,
      retry_count: args.retry_count ?? 0,
      is_initial: true,
    },
  };
}

/**
 * 构造临时提示词资源根，覆盖 SakuraLLM 专用提示词路径。
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-translation-runner-"));
  cleanup_roots.push(app_root);
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
