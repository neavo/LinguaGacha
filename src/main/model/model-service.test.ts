import crypto from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "../service/path-service";
import { SettingService } from "../service/setting-service";
import { LLMClient } from "../engine/worker/llm/llm-client";
import { ModelService } from "./model-service";

// Google SDK mock 记录构造参数，避免测试真实网络和 SDK 内部分页实现。
const google_genai_mock = vi.hoisted(() => ({
  constructor_options: [] as unknown[],
  list: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI(options: unknown) {
    google_genai_mock.constructor_options.push(options);
    return {
      models: {
        list: google_genai_mock.list,
      },
    };
  }),
}));

type ModelPresetFiles = {
  builtin_models?: Array<Record<string, ApiJsonValue>>;
  templates?: Partial<
    Record<"CUSTOM_GOOGLE" | "CUSTOM_OPENAI" | "CUSTOM_ANTHROPIC", Record<string, ApiJsonValue>>
  >;
};

type ModelServiceFixture = {
  app_root: string;
  paths: AppPathService;
  service: ModelService;
  setting_service: SettingService;
};

type LogEntry = {
  level: "info" | "warning";
  message: string;
};

afterEach(() => {
  google_genai_mock.constructor_options.length = 0;
  google_genai_mock.list.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ModelService 配置管理", () => {
  it("快照初始化保留用户模型并补齐缺失预设和自定义类型", async () => {
    stub_random_ids("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002");
    const { service } = await create_model_service(
      [
        create_model({
          id: "old-preset",
          type: "PRESET",
          api_format: "Google",
        }),
        create_model({
          id: "custom-openai",
          type: "CUSTOM_OPENAI",
        }),
      ],
      {
        builtin_models: [create_model({ id: "preset-new", type: "PRESET" })],
        templates: {
          CUSTOM_GOOGLE: create_template("template-CUSTOM_GOOGLE", "Google"),
          CUSTOM_ANTHROPIC: create_template("template-CUSTOM_ANTHROPIC", "Anthropic"),
        },
      },
    );

    const snapshot = read_model_snapshot(service.get_snapshot());

    expect(snapshot.models.map((model) => model["id"])).toContain("preset-new");
    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "old-preset", type: "PRESET" }),
        expect.objectContaining({ id: "custom-openai", type: "CUSTOM_OPENAI" }),
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000001",
          name: "template-CUSTOM_GOOGLE",
          type: "CUSTOM_GOOGLE",
        }),
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000002",
          name: "template-CUSTOM_ANTHROPIC",
          type: "CUSTOM_ANTHROPIC",
        }),
      ]),
    );
  });

  it("空模型配置按内置预设后补齐三类自定义模型", async () => {
    stub_random_ids(
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
    );
    const { service } = await create_model_service([], {
      builtin_models: [
        create_model({ id: "preset-1", type: "PRESET" }),
        create_model({ id: "preset-2", type: "PRESET" }),
      ],
    });

    const snapshot = read_model_snapshot(service.get_snapshot());

    expect(snapshot.models.map((model) => model["id"]).slice(0, 2)).toEqual([
      "preset-1",
      "preset-2",
    ]);
    expect(snapshot.models.slice(2).map((model) => model["type"])).toEqual([
      "CUSTOM_GOOGLE",
      "CUSTOM_OPENAI",
      "CUSTOM_ANTHROPIC",
    ]);
  });

  it("初始化不会重复追加已经存在的内置预设", async () => {
    const { service } = await create_model_service(
      [
        create_model({ id: "preset-1", type: "PRESET" }),
        create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
        create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
        create_model({ id: "anthropic", type: "CUSTOM_ANTHROPIC", api_format: "Anthropic" }),
      ],
      {
        builtin_models: [create_model({ id: "preset-1", type: "PRESET" })],
      },
    );

    const snapshot = read_model_snapshot(service.get_snapshot());

    expect(snapshot.models.filter((model) => model["id"] === "preset-1")).toHaveLength(1);
  });

  it("同一配置路径下的新服务实例读取同一模型事实", async () => {
    stub_random_ids("00000000-0000-4000-8000-000000000021");
    const { paths, service, setting_service } = await create_model_service([
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
      create_model({ id: "anthropic", type: "CUSTOM_ANTHROPIC", api_format: "Anthropic" }),
    ]);

    await service.add_model({ model_type: "CUSTOM_OPENAI" });
    const second_service = new ModelService(paths, setting_service);
    const snapshot = read_model_snapshot(second_service.get_snapshot());

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000021",
          type: "CUSTOM_OPENAI",
        }),
      ]),
    );
  });

  it("新增自定义模型使用对应模板并生成新 ID", async () => {
    stub_random_ids("00000000-0000-4000-8000-000000000031");
    const { service } = await create_model_service(
      [
        create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
        create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
        create_model({ id: "anthropic", type: "CUSTOM_ANTHROPIC", api_format: "Anthropic" }),
      ],
      {
        templates: {
          CUSTOM_OPENAI: create_template("custom-model", "OpenAI"),
        },
      },
    );

    const snapshot = read_model_snapshot(await service.add_model({ model_type: "CUSTOM_OPENAI" }));

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000031",
          name: "custom-model",
          type: "CUSTOM_OPENAI",
        }),
      ]),
    );
  });

  it("未知模型类型不能新增自定义模型", async () => {
    const { service } = await create_model_service([]);

    await expect(service.add_model({ model_type: "PRESET" })).rejects.toThrow("模型类型无效");
  });

  it("删除激活模型时优先回退到同类型模型", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "openai-a", type: "CUSTOM_OPENAI" }),
      create_model({ id: "openai-b", type: "CUSTOM_OPENAI" }),
    ]);
    await service.activate_model({ model_id: "openai-a" });

    const snapshot = read_model_snapshot(await service.delete_model({ model_id: "openai-a" }));

    expect(snapshot.active_model_id).toBe("openai-b");
    expect(snapshot.models.map((model) => model["id"])).not.toContain("openai-a");
  });

  it("删除激活模型时没有同类型则回退到预设模型", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
    ]);
    await service.activate_model({ model_id: "google" });

    const snapshot = read_model_snapshot(await service.delete_model({ model_id: "google" }));

    expect(snapshot.active_model_id).toBe("preset");
  });

  it("删除激活模型时没有预设则回退到列表第一个模型", async () => {
    const { service } = await create_model_service([
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
    ]);
    await service.activate_model({ model_id: "google" });

    const snapshot = read_model_snapshot(await service.delete_model({ model_id: "google" }));

    expect(snapshot.active_model_id).toBe("openai");
  });

  it("删除唯一已配置模型前会先补齐默认类型并回退到默认模型", async () => {
    stub_random_ids("00000000-0000-4000-8000-000000000041", "00000000-0000-4000-8000-000000000042");
    const { service } = await create_model_service([
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
    ]);
    await service.activate_model({ model_id: "google" });

    const snapshot = read_model_snapshot(await service.delete_model({ model_id: "google" }));

    expect(snapshot.models.map((model) => model["type"])).toEqual([
      "CUSTOM_OPENAI",
      "CUSTOM_ANTHROPIC",
    ]);
    expect(snapshot.active_model_id).toBe("00000000-0000-4000-8000-000000000041");
  });

  it("删除非激活模型不会改变当前激活 ID", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
    ]);
    await service.activate_model({ model_id: "openai" });

    const snapshot = read_model_snapshot(await service.delete_model({ model_id: "google" }));

    expect(snapshot.active_model_id).toBe("openai");
  });

  it("预设模型和不存在的模型不能删除", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
    ]);

    await expect(service.delete_model({ model_id: "preset" })).rejects.toThrow(
      "内置预设模型不能删除",
    );
    await expect(service.delete_model({ model_id: "missing" })).rejects.toThrow("模型配置不存在");
  });

  it("更新模型只应用白名单字段并重建快照", async () => {
    const { service } = await create_model_service([
      create_model({ id: "custom", type: "CUSTOM_OPENAI" }),
    ]);

    const snapshot = read_model_snapshot(
      await service.update_model({
        model_id: "custom",
        patch: {
          generation: { top_p_custom_enable: true },
          name: "updated-name",
          threshold: { concurrency_limit: 2 },
        },
      }),
    );

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: expect.objectContaining({ top_p_custom_enable: true }),
          id: "custom",
          name: "updated-name",
          threshold: expect.objectContaining({ concurrency_limit: 2 }),
        }),
      ]),
    );
  });

  it("更新不存在模型或未知字段会返回业务错误", async () => {
    const { service } = await create_model_service([
      create_model({ id: "custom", type: "CUSTOM_OPENAI" }),
    ]);

    await expect(
      service.update_model({ model_id: "missing", patch: { name: "updated-name" } }),
    ).rejects.toThrow("模型配置不存在");
    await expect(
      service.update_model({ model_id: "custom", patch: { forbidden: "value" } }),
    ).rejects.toThrow("模型配置包含不允许的字段");
  });

  it("重置预设模型时从内置预设重新读取目标条目", async () => {
    const { service } = await create_model_service(
      [
        create_model({ id: "other", name: "other-old", type: "PRESET" }),
        create_model({ id: "target", name: "target-old", type: "PRESET" }),
      ],
      {
        builtin_models: [
          create_model({ id: "unmatched", name: "unmatched", type: "PRESET" }),
          create_model({ id: "target", name: "target-updated", type: "PRESET" }),
        ],
      },
    );

    const snapshot = read_model_snapshot(await service.reset_preset_model({ model_id: "target" }));

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "target", name: "target-updated" }),
        expect.objectContaining({ id: "other", name: "other-old" }),
      ]),
    );
  });

  it("非预设模型和缺失内置条目不能重置", async () => {
    const { service } = await create_model_service([
      create_model({ id: "custom", type: "CUSTOM_OPENAI" }),
      create_model({ id: "preset", type: "PRESET" }),
    ]);

    await expect(service.reset_preset_model({ model_id: "custom" })).rejects.toThrow(
      "该模型不是内置预设",
    );
    await expect(service.reset_preset_model({ model_id: "preset" })).rejects.toThrow(
      "模型配置不存在",
    );
  });

  it("重排模型只调整目标分组并保留其他分组成员", async () => {
    const { service } = await create_model_service([
      create_model({ id: "p1", type: "PRESET" }),
      create_model({ id: "o1", type: "CUSTOM_OPENAI" }),
      create_model({ id: "o2", type: "CUSTOM_OPENAI" }),
      create_model({ id: "g1", type: "CUSTOM_GOOGLE", api_format: "Google" }),
      create_model({ id: "o3", type: "CUSTOM_OPENAI" }),
      create_model({ id: "a1", type: "CUSTOM_ANTHROPIC", api_format: "Anthropic" }),
    ]);

    const snapshot = read_model_snapshot(
      await service.reorder_model({ ordered_model_ids: ["o2", "o3", "o1"] }),
    );

    expect(read_model_ids_by_type(snapshot.models, "CUSTOM_OPENAI")).toEqual(["o2", "o3", "o1"]);
    expect(read_model_ids_by_type(snapshot.models, "PRESET")).toEqual(["p1"]);
    expect(read_model_ids_by_type(snapshot.models, "CUSTOM_GOOGLE")).toEqual(["g1"]);
    expect(read_model_ids_by_type(snapshot.models, "CUSTOM_ANTHROPIC")).toEqual(["a1"]);
  });

  it("重排请求必须完整匹配单个模型分组", async () => {
    const { service } = await create_model_service([
      create_model({ id: "a", type: "PRESET" }),
      create_model({ id: "b", type: "CUSTOM_OPENAI" }),
    ]);

    await expect(service.reorder_model({ ordered_model_ids: [] })).rejects.toThrow(
      "模型排序列表不能为空",
    );
    await expect(service.reorder_model({ ordered_model_ids: ["missing", "b"] })).rejects.toThrow(
      "模型配置不存在",
    );
    await expect(service.reorder_model({ ordered_model_ids: ["b", "a"] })).rejects.toThrow(
      "模型排序必须完整覆盖同一分组",
    );
  });
});

describe("ModelService 远端模型能力", () => {
  it("OpenAI-compatible list-available 使用首个 key、自定义 baseUrl 与额外 header", async () => {
    const { service } = await create_model_service([
      create_model({
        api_format: "OpenAI",
        api_key: "key-a\nkey-b",
        api_url: "https://api.example/v1/chat/completions",
        id: "openai-1",
        request: {
          extra_headers: { "X-Trace": "trace-1" },
          extra_headers_custom_enable: true,
        },
      }),
    ]);
    const fetch_mock = vi.fn(async () => json_response({ data: [{ id: "model-a" }] }));
    vi.stubGlobal("fetch", fetch_mock);

    const result = await service.list_available_models({ model_id: "openai-1" });

    expect(result["models"]).toEqual(["model-a"]);
    expect(fetch_mock).toHaveBeenCalledWith(
      "https://api.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer key-a",
          "User-Agent": expect.stringContaining("Chrome/133"),
          "X-Trace": "trace-1",
        }),
        method: "GET",
      }),
    );
  });

  it("Google list-available 使用 SDK 与归一化后的 baseUrl", async () => {
    google_genai_mock.list.mockResolvedValue(
      create_google_model_pager([
        { name: "models/gemini-2.5-flash" },
        { name: "" },
        { displayName: "missing-name" },
        { name: "models/gemini-2.5-pro" },
      ]),
    );
    const { service } = await create_model_service([
      create_model({
        api_format: "Google",
        api_key: "google-key-a\ngoogle-key-b",
        api_url: "https://generativelanguage.googleapis.com/v1beta",
        id: "google-1",
        request: {
          extra_headers: { "X-Trace": "trace-google" },
          extra_headers_custom_enable: true,
        },
      }),
    ]);
    const fetch_mock = vi.fn();
    vi.stubGlobal("fetch", fetch_mock);

    const result = await service.list_available_models({ model_id: "google-1" });

    expect(result["models"]).toEqual(["models/gemini-2.5-flash", "models/gemini-2.5-pro"]);
    expect(fetch_mock).not.toHaveBeenCalled();
    expect(google_genai_mock.list).toHaveBeenCalledWith();
    expect(google_genai_mock.constructor_options).toEqual([
      expect.objectContaining({
        apiKey: "google-key-a",
        httpOptions: expect.objectContaining({
          baseUrl: "https://generativelanguage.googleapis.com",
          headers: expect.objectContaining({
            "User-Agent": expect.stringContaining("Chrome/133"),
            "X-Trace": "trace-google",
          }),
        }),
      }),
    ]);
  });

  it("Google list-available 空 URL 交给 SDK 默认 baseUrl", async () => {
    google_genai_mock.list.mockResolvedValue(
      create_google_model_pager([{ name: "models/gemini-2.5-flash" }]),
    );
    const { service } = await create_model_service([
      create_model({
        api_format: "Google",
        api_key: "google-key",
        api_url: "",
        id: "google-1",
      }),
    ]);

    const result = await service.list_available_models({ model_id: "google-1" });

    expect(result["models"]).toEqual(["models/gemini-2.5-flash"]);
    expect(google_genai_mock.constructor_options).toEqual([
      expect.objectContaining({
        apiKey: "google-key",
        httpOptions: expect.objectContaining({ baseUrl: undefined }),
      }),
    ]);
  });

  it("Anthropic list-available 保持既有实时列表协议", async () => {
    const { service } = await create_model_service([
      create_model({
        api_format: "Anthropic",
        api_key: "anthropic-key",
        api_url: "",
        id: "anthropic-1",
      }),
    ]);
    const fetch_mock = vi
      .fn()
      .mockResolvedValueOnce(json_response({ data: [{ id: "claude-sonnet-4-5" }] }));
    vi.stubGlobal("fetch", fetch_mock);

    const anthropic_result = await service.list_available_models({ model_id: "anthropic-1" });

    expect(anthropic_result["models"]).toEqual(["claude-sonnet-4-5"]);
    expect(fetch_mock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/models");
    expect(fetch_mock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "anthropic-version": "2023-06-01",
        "x-api-key": "anthropic-key",
      }),
    });
  });

  it("模型连通性测试复用 LLM request client 并按 key 汇总结果", async () => {
    const log_entries: LogEntry[] = [];
    const { service } = await create_model_service(
      [
        create_model({
          api_format: "OpenAI",
          api_key: "1234567890abcdefXYZ\nbad-key",
          id: "test-1",
        }),
      ],
      {},
      log_entries,
    );
    const request_mock = vi
      .spyOn(LLMClient.prototype, "request")
      .mockResolvedValueOnce({
        cancelled: false,
        degraded: false,
        error: "",
        input_tokens: 2,
        output_tokens: 3,
        response_result: '{"0":"成功"}',
        response_think: "",
        timeout: false,
      })
      .mockResolvedValueOnce({
        cancelled: false,
        degraded: false,
        error: "",
        input_tokens: 0,
        output_tokens: 0,
        response_result: "",
        response_think: "",
        timeout: true,
      });
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1250)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2250);

    const result = await service.test_model({ model_id: "test-1" });

    expect(request_mock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      failure_count: 1,
      success: false,
      success_count: 1,
      total_count: 2,
    });
    expect(result["key_results"]).toEqual([
      expect.objectContaining({
        input_tokens: 2,
        masked_key: "12345678***bcdefXYZ",
        output_tokens: 3,
        success: true,
      }),
      expect.objectContaining({
        error_reason: "请求超时（120 秒）",
        masked_key: "*******",
        success: false,
      }),
    ]);
    expect(log_entries.map((entry) => [entry.level, entry.message])).toEqual([
      ["info", ""],
      ["info", "正在测试密钥：\n12345678***bcdefXYZ"],
      [
        "info",
        "任务提示词：\n[{'role': 'system', 'content': '任务目标是将内容文本翻译成中文，译文必须严格保持原文的格式。'}, {'role': 'user', 'content': '{\"0\":\"魔導具師ダリヤはうつむかない\"}'}]",
      ],
      ["info", '模型回复内容：\n{"0":"成功"}'],
      ["info", "任务耗时 0.25 秒，输入消耗 2 Tokens，输出消耗 3 Tokens"],
      ["info", ""],
      ["info", "正在测试密钥：\n*******"],
      [
        "info",
        "任务提示词：\n[{'role': 'system', 'content': '任务目标是将内容文本翻译成中文，译文必须严格保持原文的格式。'}, {'role': 'user', 'content': '{\"0\":\"魔導具師ダリヤはうつむかない\"}'}]",
      ],
      ["warning", "接口测试失败 …\n原因：请求超时（120 秒）"],
      ["info", ""],
      ["info", "共测试 2 个接口，成功 1 个，失败 1 个 …"],
      ["warning", "失败的密钥：\n*******"],
    ]);
  });
});

/**
 * 构造带最小资源目录的 ModelService，避免用例读取真实预设文件
 */
async function create_model_service(
  models: Array<Record<string, ApiJsonValue>>,
  presets: ModelPresetFiles = {},
  log_entries?: LogEntry[],
): Promise<ModelServiceFixture> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-model-service-"));
  await write_model_presets(app_root, presets);
  const paths = new AppPathService({ appRoot: app_root });
  const setting_service = new SettingService(paths);
  setting_service.save_setting({
    activate_model_id: models[0]?.["id"] ?? "",
    models: models as unknown as ApiJsonValue,
  });
  const log_manager =
    log_entries === undefined
      ? undefined
      : {
          info(message: string): void {
            log_entries.push({ level: "info", message });
          },
          warning(message: string): void {
            log_entries.push({ level: "warning", message });
          },
        };
  return {
    app_root,
    paths,
    service: new ModelService(paths, setting_service, log_manager),
    setting_service,
  };
}

/**
 * 生成默认模型记录，测试只覆盖被 overrides 指定的差异字段
 */
function create_model(
  overrides: Partial<Record<string, ApiJsonValue>>,
): Record<string, ApiJsonValue> {
  return {
    api_format: "OpenAI",
    api_key: "key",
    api_url: "https://api.example/v1",
    generation: {},
    id: "model-1",
    model_id: "gpt-5-mini",
    name: "模型",
    request: {
      extra_body: {},
      extra_body_custom_enable: false,
      extra_headers: {},
      extra_headers_custom_enable: false,
    },
    thinking: { level: "OFF" },
    threshold: { input_token_limit: 512, output_token_limit: 4096 },
    type: "CUSTOM_OPENAI",
    ...overrides,
  };
}

/**
 * 写入 ModelService 初始化需要的预设文件，内容保持由测试显式控制
 */
async function write_model_presets(app_root: string, presets: ModelPresetFiles): Promise<void> {
  const preset_dir = path.join(app_root, "resource", "model", "preset");
  await mkdir(preset_dir, { recursive: true });
  await writeFile(
    path.join(preset_dir, "preset_model_builtin.json"),
    JSON.stringify(presets.builtin_models ?? []),
    "utf-8",
  );
  await writeFile(
    path.join(preset_dir, "preset_model_custom_google.json"),
    JSON.stringify(presets.templates?.CUSTOM_GOOGLE ?? {}),
    "utf-8",
  );
  await writeFile(
    path.join(preset_dir, "preset_model_custom_openai.json"),
    JSON.stringify(presets.templates?.CUSTOM_OPENAI ?? {}),
    "utf-8",
  );
  await writeFile(
    path.join(preset_dir, "preset_model_custom_anthropic.json"),
    JSON.stringify(presets.templates?.CUSTOM_ANTHROPIC ?? {}),
    "utf-8",
  );
}

/**
 * 构造 fetch 可消费的 JSON Response，避免每个用例重复序列化
 */
function json_response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

/**
 * 模拟 Google SDK pager 的 async iterable 形态，测试只关心 ModelService 的读取边界。
 */
async function* create_google_model_pager(
  models: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const model of models) {
    yield model;
  }
}

function create_template(name: string, api_format: string): Record<string, ApiJsonValue> {
  return {
    api_format,
    api_key: "k",
    api_url: "",
    model_id: "m",
    name,
  };
}

function read_model_snapshot(response: Record<string, ApiJsonValue>): {
  active_model_id: string;
  models: Array<Record<string, ApiJsonValue>>;
} {
  const snapshot = response["snapshot"];
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    throw new Error("测试夹具缺少模型快照");
  }
  const models = snapshot["models"];
  return {
    active_model_id: String(snapshot["active_model_id"] ?? ""),
    models: Array.isArray(models)
      ? models.filter(
          (model): model is Record<string, ApiJsonValue> =>
            typeof model === "object" && model !== null && !Array.isArray(model),
        )
      : [],
  };
}

function read_model_ids_by_type(
  models: Array<Record<string, ApiJsonValue>>,
  model_type: string,
): string[] {
  return models
    .filter((model) => String(model["type"] ?? "") === model_type)
    .map((model) => String(model["id"] ?? ""));
}

function stub_random_ids(...ids: string[]): void {
  const queue = [...ids];
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    return (queue.shift() ?? "00000000-0000-4000-8000-000000000099") as ReturnType<
      typeof crypto.randomUUID
    >;
  });
}
