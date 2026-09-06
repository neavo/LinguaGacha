import { Model } from "../../../../domain/model";
import { normalize_setting_snapshot } from "../../../../domain/setting";
import { TextQualitySnapshotTool } from "../../../../shared/text/text-types";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../../../domain/json";
import { TranslationWorkUnitRunner } from "./translation-runner";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../../../llm/llm-types";
import type { TranslationWorkUnit, WorkUnitLogEntry } from "../../protocol/work-unit";

const cleanup_roots: string[] = [];

/** 日志状态断言只读取用户可见摘要，不依赖纯文本投影格式。 */
function read_log_summary(entry: WorkUnitLogEntry | undefined): string {
  return entry?.content.summary.join("\n") ?? "";
}

/** 收窄翻译日志判别联合，测试随后只断言公开结构化结果。 */
function read_translation_log(
  entry: WorkUnitLogEntry | undefined,
): Extract<WorkUnitLogEntry["content"], { kind: "translation_result" }> {
  if (entry?.content.kind !== "translation_result") {
    throw new Error("期望翻译结果日志");
  }
  return entry.content;
}

/**
 * 构造无条目的翻译 work unit，验证 runner 不会为无效 chunk 请求模型。
 */
function create_empty_translation_unit(): TranslationWorkUnit {
  return {
    kind: "translation",
    unit_id: "translation-unit-1",
    run_id: "run-1",
    model: { ...Model.from_json({}, "test") },
    config_snapshot: normalize_setting_snapshot({}),
    quality_snapshot: TextQualitySnapshotTool.from_api_value({}),
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
        reasoning_tokens: 0,
        output_tokens: 0,
      },
      output: {
        kind: "translation",
        items: [],
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
          response_result: "你好",
          input_tokens: 1,
          reasoning_tokens: 0,
          output_tokens: 1,
          cancelled: false,
          timeout: false,
        };
      }),
    };
    const runner = new TranslationWorkUnitRunner(await create_template_root(), llm_client);

    const result = await runner.execute_unit(
      {
        kind: "translation",
        unit_id: "translation-unit-1",
        run_id: "run-1",
        model: { ...Model.from_json({ api_format: "SakuraLLM" }, "test") },
        config_snapshot: normalize_setting_snapshot(
          create_config_payload({ prompt_enhancement_enable: false }),
        ),
        quality_snapshot: TextQualitySnapshotTool.from_api_value(create_quality_payload()),
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
            '{"index":0,"actor":"虎铁","text":"你好"}\n{"index":1,"actor":null,"text":"旁白译文"}',
          input_tokens: 4,
          reasoning_tokens: 2,
          output_tokens: 5,
        },
        captured_requests,
      ),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "OpenAI" },
        config_overrides: { prompt_enhancement_enable: false },
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
      items: [
        { id: 1, dst: "你好", name_dst: "虎铁", status: "PROCESSED" },
        { id: 2, dst: "旁白译文", name_dst: "既有译名", status: "PROCESSED" },
      ],
    });
    expect(result.metrics).toMatchObject({
      input_tokens: 4,
      reasoning_tokens: 2,
      output_tokens: 5,
    });
    expect(result.logs[0]?.level).toBe("info");
    expect(read_translation_log(result.logs[0]).pairs).toEqual([
      { src: "こんにちは", dst: "你好", actor_src: "虎鉄", actor_dst: "虎铁" },
      { src: "地の文", dst: "旁白译文", actor_src: null, actor_dst: null },
    ]);
    expect(captured_requests[0]?.messages[1]?.content).toContain(
      '{"index":0,"actor":"虎鉄","text":"こんにちは"}',
    );
    expect(captured_requests[0]?.messages[1]?.content).toContain(
      '{"index":1,"actor":null,"text":"地の文"}',
    );
    expect(captured_requests[0]?.messages[0]?.content).not.toContain("提示词增强");
  });

  it("按 work unit 顺序投影上文和请求引用并在提交前恢复", async () => {
    const captured_requests: LLMRequestBody[] = [];
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client(
        {
          response_result:
            '{"index":0,"actor":"lg-uri/1","text":"查看 lg-uri/2"}\n{"index":1,"actor":null,"text":"图片 lg-uri/3"}',
        },
        captured_requests,
      ),
    );
    const unit = create_translation_unit({
      model: { api_format: "OpenAI" },
      items: [
        {
          id: 1,
          src: "打开 https://example.com/guide",
          name_src: "data:image/png;base64,AAAA",
          dst: "",
          status: "NONE",
          text_type: "TXT",
        },
        {
          id: 2,
          src: "查看 image.png",
          dst: "",
          status: "NONE",
          text_type: "TXT",
        },
      ],
    });
    unit.payload.precedings = [
      { id: 9, src: "上文 https://previous.example", status: "PROCESSED", text_type: "TXT" },
    ];

    const result = await runner.execute_unit(unit, new AbortController().signal);

    expect(captured_requests[0]?.messages[1]?.content).toContain("上文 lg-uri/0");
    expect(captured_requests[0]?.messages[1]?.content).toContain(
      '{"index":0,"actor":"lg-uri/1","text":"打开 lg-uri/2"}',
    );
    expect(result.output).toMatchObject({
      kind: "translation",
      items: [
        {
          dst: "查看 https://example.com/guide",
          name_dst: "data:image/png;base64,AAAA",
        },
        { dst: "图片 image.png" },
      ],
    });
  });

  it("术语只按预处理前的原始正文与姓名激活，并忽略空译文", async () => {
    const captured_requests: LLMRequestBody[] = [];
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client(
        { response_result: '{"index":0,"actor":"爱丽丝","text":"生命值"}' },
        captured_requests,
      ),
    );
    const quality = create_quality_payload();
    const quality_block = quality["quality"] as JsonRecord;
    quality_block["glossary"] = {
      enabled: true,
      entries: [
        { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: true },
        { entry_id: "mana", src: "Mana", dst: "魔力", info: "", case_sensitive: true },
        { entry_id: "alice", src: "Alice", dst: "爱丽丝", info: "", case_sensitive: false },
        { entry_id: "empty", src: "HP", dst: "   ", info: "", case_sensitive: true },
      ],
    };
    quality_block["pre_replacement"] = {
      enabled: true,
      entries: [{ entry_id: "hp", src: "HP", dst: "Mana", regex: false, case_sensitive: true }],
    };

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "OpenAI" },
        quality_snapshot: quality,
        config_overrides: { prompt_enhancement_enable: false },
        items: [
          {
            id: 1,
            src: "HP",
            name_src: "Alice",
            dst: "",
            status: "NONE",
            text_type: "TXT",
          },
        ],
      }),
      new AbortController().signal,
    );

    const prompt = captured_requests[0]?.messages[1]?.content ?? "";
    expect(prompt).toContain("HP -> 生命值");
    expect(prompt).toContain("Alice -> 爱丽丝");
    expect(prompt).not.toContain("Mana -> 魔力");
    expect(prompt).not.toContain("HP ->    ");
    expect(prompt).toContain("Mana");
    expect(read_log_summary(result.logs[0])).toContain("HP -> 生命值");
  });

  it("术语全局关闭时普通与 Sakura 请求都不注入术语", async () => {
    for (const api_format of ["OpenAI", "SakuraLLM"]) {
      const captured_requests: LLMRequestBody[] = [];
      const quality = create_quality_payload();
      (quality["quality"] as JsonRecord)["glossary"] = {
        enabled: false,
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }],
      };
      const runner = new TranslationWorkUnitRunner(
        await create_template_root(),
        create_llm_client(
          { response_result: api_format === "SakuraLLM" ? "译文" : '{"index":0,"text":"译文"}' },
          captured_requests,
        ),
      );

      await runner.execute_unit(
        create_translation_unit({
          model: { api_format },
          quality_snapshot: quality,
          config_overrides: { prompt_enhancement_enable: false },
          src: "HP",
        }),
        new AbortController().signal,
      );

      expect(captured_requests[0]?.messages[1]?.content).not.toContain("生命值");
    }
  });

  it("翻译日志的请求用时覆盖 LLM 等待时间", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));
    const runner = new TranslationWorkUnitRunner(await create_template_root(), {
      request: async () => {
        vi.setSystemTime(new Date(3500));
        return {
          response_think: "",
          response_result: '{"index":0,"text":"你好"}',
          input_tokens: 4,
          reasoning_tokens: 0,
          output_tokens: 5,
          cancelled: false,
          timeout: false,
        };
      },
    });

    const result = await runner.execute_unit(
      create_translation_unit({ model: { api_format: "OpenAI" } }),
      new AbortController().signal,
    );

    expect(read_log_summary(result.logs[0])).toContain("任务耗时 2.50 秒");
  });

  it("翻译日志分离模型思考、规则分析和译文", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_think: "真实思考链",
        response_result: '<why>[核心约束]：保持行数</why>\n{"index":0,"text":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({ model: { api_format: "OpenAI" } }),
      new AbortController().signal,
    );

    expect(read_translation_log(result.logs[0]).sections).toEqual([
      { title: "思考过程：", text: "真实思考链" },
      { title: "规则分析：", text: "[核心约束]：保持行数" },
      { title: "翻译结果：", text: '{"index":0,"text":"你好"}' },
    ]);
  });

  it("LLM 请求失败时显示实际错误并在结构化字段保留诊断", async () => {
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
    expect(read_log_summary(result.logs[0])).toContain("供应商爆炸");
    expect(read_log_summary(result.logs[0])).not.toContain("ProviderError:");
  });

  it("零有效译文时记录错误结果", async () => {
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
    expect(result.logs[0]?.level).toBe("error");
  });

  it("模型请求超时时记录错误结果", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({ timeout: true }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({ model: { api_format: "OpenAI" } }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("failed");
    expect(result.logs[0]?.level).toBe("error");
  });

  it("item 内换行数量变化时仍按完整译文提交", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: "你好",
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "SakuraLLM" },
        src: "こんにちは\n世界",
      }),
      new AbortController().signal,
    );

    expect(result.outcome).toBe("success");
    expect(result.output).toMatchObject({
      kind: "translation",
      items: [{ dst: "你好", status: "PROCESSED" }],
    });
  });

  it("多条 item 响应按序号独立提交，缺失项保持待处理", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: '{"index":0,"text":"你好"}',
      }),
    );

    const result = await runner.execute_unit(
      create_translation_unit({
        model: { api_format: "OpenAI" },
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

    expect(result.outcome).toBe("success");
    expect(result.logs[0]?.level).toBe("warning");
    expect(result.output).toMatchObject({
      kind: "translation",
      items: [
        { id: 1, dst: "你好", status: "PROCESSED", retry_count: 2 },
        { id: 2, dst: "", status: "NONE", retry_count: 2 },
      ],
    });
    expect(read_translation_log(result.logs[0]).pairs).toEqual([
      { src: "こんにちは", dst: "你好" },
      { src: "世界", dst: "" },
    ]);
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
      items: [
        {
          id: 1,
          dst: "",
          status: "NONE",
          retry_count: 3,
        },
      ],
    });
  });

  it("item 内尾部空行不阻止译文提交", async () => {
    const runner = new TranslationWorkUnitRunner(
      await create_template_root(),
      create_llm_client({
        response_result: "你好\n",
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
      items: [
        {
          id: 1,
          status: "PROCESSED",
          retry_count: 2,
        },
      ],
    });
    expect((result.output as { items: Array<{ dst?: string }> }).items[0]?.dst).toContain("你好");
  });
});

/**
 * 构造 runner 所需配置快照，字段名对齐任务启动载荷。
 */
function create_config_payload(overrides: JsonRecord = {}): JsonRecord {
  return {
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
    ...overrides,
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
        reasoning_tokens: 0,
        output_tokens: 1,
        cancelled: false,
        timeout: false,
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
  config_overrides?: JsonRecord;
  quality_snapshot?: JsonRecord;
}): TranslationWorkUnit {
  return {
    kind: "translation",
    unit_id: "translation-unit-1",
    run_id: "run-1",
    model: { ...Model.from_json(args.model, "test") },
    config_snapshot: normalize_setting_snapshot(create_config_payload(args.config_overrides)),
    quality_snapshot: TextQualitySnapshotTool.from_api_value(
      args.quality_snapshot ?? create_quality_payload(),
    ),
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
  const builtin_root = await mkdtemp(path.join(tmpdir(), "linguagacha-translation-runner-"));
  cleanup_roots.push(builtin_root);
  const dir = path.join(builtin_root, "translation_prompt", "template", "zh");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "prefix.txt"), "前缀", "utf-8");
  await writeFile(path.join(dir, "base.txt"), "从 {source_language} 到 {target_language}", "utf-8");
  await writeFile(path.join(dir, "thinking.txt"), "提示词增强", "utf-8");
  await writeFile(
    path.join(dir, "suffix.txt"),
    "输出 JSONLINE\n{translation_output_format}",
    "utf-8",
  );
  return builtin_root;
}
