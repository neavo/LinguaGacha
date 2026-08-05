import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { Model, type CustomModelType } from "../../domain/model";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { LLMClient } from "../llm/llm-client";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ModelService } from "./model-service";

type ModelPresetFiles = {
  builtin_models?: Array<JsonRecord>;
  templates?: Partial<Record<CustomModelType, JsonRecord>>;
};

type ModelServiceFixture = {
  app_root: string;
  paths: AppPathService;
  service: ModelService;
  app_setting_service: AppSettingService;
  runtime_gate: RuntimeOperationGate;
};

type LogEntry = {
  level: "info" | "warning";
  message: string;
  payload?: Record<string, unknown>;
};

const TEST_LLM_USER_AGENT = "LinguaGacha/v9.8.7 (https://github.com/neavo/LinguaGacha)";
const cleanup_roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    cleanup_roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("ModelService 配置管理", () => {
  it("快照初始化保留用户模型并补齐缺失预设和自定义类型", async () => {
    stub_random_ids(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    );
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
          CUSTOM_OPENAI_RESPONSES: create_template(
            "template-CUSTOM_OPENAI_RESPONSES",
            "OpenAIResponses",
          ),
          CUSTOM_ANTHROPIC: create_template("template-CUSTOM_ANTHROPIC", "Anthropic"),
        },
      },
    );

    const snapshot = read_request_model_snapshot(service.get_snapshot());

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
          name: "template-CUSTOM_OPENAI_RESPONSES",
          type: "CUSTOM_OPENAI_RESPONSES",
        }),
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000003",
          name: "template-CUSTOM_ANTHROPIC",
          type: "CUSTOM_ANTHROPIC",
        }),
      ]),
    );
  });

  it("空模型配置按内置预设后补齐全部自定义模型", async () => {
    stub_random_ids(
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
      "00000000-0000-4000-8000-000000000014",
    );
    const { service } = await create_model_service([], {
      builtin_models: [
        create_model({ id: "preset-1", type: "PRESET" }),
        create_model({ id: "preset-2", type: "PRESET" }),
      ],
    });

    const snapshot = read_request_model_snapshot(service.get_snapshot());
    const selection = read_selection_snapshot(service.get_selection_snapshot());

    expect(snapshot.models.map((model) => model["id"]).slice(0, 2)).toEqual([
      "preset-1",
      "preset-2",
    ]);
    expect(snapshot.models.slice(2).map((model) => model["type"])).toEqual([
      "CUSTOM_GOOGLE",
      "CUSTOM_OPENAI",
      "CUSTOM_OPENAI_RESPONSES",
      "CUSTOM_ANTHROPIC",
    ]);
    expect(selection.model_selection).toEqual({
      translation: "preset-1",
      analysis: "preset-1",
      agent: "preset-1",
    });
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

    const snapshot = read_request_model_snapshot(service.get_snapshot());

    expect(snapshot.models.filter((model) => model["id"] === "preset-1")).toHaveLength(1);
  });

  it("同一配置路径下的新服务实例读取同一模型事实", async () => {
    stub_random_ids("00000000-0000-4000-8000-000000000021");
    const { paths, service, app_setting_service } = await create_model_service([
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
      create_model({
        id: "responses",
        type: "CUSTOM_OPENAI_RESPONSES",
        api_format: "OpenAIResponses",
      }),
      create_model({ id: "anthropic", type: "CUSTOM_ANTHROPIC", api_format: "Anthropic" }),
    ]);

    await service.add_model({ model_type: "CUSTOM_OPENAI" });
    await service.update_model({
      model_id: "00000000-0000-4000-8000-000000000021",
      patch: { agent: { context_window: 400_000, max_output_tokens: 50_000 } },
    });
    const second_service = new ModelService(
      paths,
      app_setting_service,
      TEST_LLM_USER_AGENT,
      new RuntimeOperationGate(),
    );
    const snapshot = read_request_model_snapshot(second_service.get_snapshot());

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000021",
          type: "CUSTOM_OPENAI",
          agent: { context_window: 400_000, max_output_tokens: 50_000 },
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
        create_model({
          id: "responses",
          type: "CUSTOM_OPENAI_RESPONSES",
          api_format: "OpenAIResponses",
        }),
        create_model({ id: "anthropic", type: "CUSTOM_ANTHROPIC", api_format: "Anthropic" }),
      ],
      {
        templates: {
          CUSTOM_OPENAI: create_template("custom-model", "OpenAI"),
        },
      },
    );

    const snapshot = read_request_model_snapshot(
      await service.add_model({ model_type: "CUSTOM_OPENAI" }),
    );

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

    expect(() => service.add_model({ model_type: "PRESET" })).toThrow("request.validation_failed");
  });

  it("选择单个用途不会改变另外两个用途，且公开快照不含敏感配置", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "openai-a", type: "CUSTOM_OPENAI" }),
      create_model({ id: "openai-b", type: "CUSTOM_OPENAI" }),
    ]);

    const snapshot = read_selection_snapshot(
      service.select_model({ usage: "analysis", model_id: "openai-a" }),
    );

    expect(snapshot.model_selection).toEqual({
      translation: "preset",
      analysis: "openai-a",
      agent: "preset",
    });
    expect(snapshot.models[0]).toEqual({
      id: "preset",
      type: "PRESET",
      name: "模型",
      agent: { context_window: 288_000, max_output_tokens: 32_000 },
      thinking_level: "OFF",
      thinking_configurable: true,
    });
    expect(snapshot.models[0]).not.toHaveProperty("api_key");
  });

  it("按用途更新当前模型思考档位并保持选择快照狭窄", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
    ]);
    service.select_model({ usage: "agent", model_id: "openai" });

    const selection = read_selection_snapshot(
      service.update_selected_model_thinking_level({ usage: "agent", thinking_level: "HIGH" }),
    );
    const selected = selection.models.find((model) => model["id"] === "openai");
    const management = read_request_model_snapshot(service.get_snapshot());
    const persisted = management.models.find((model) => model["id"] === "openai");

    expect(selected).toMatchObject({
      thinking_level: "HIGH",
      thinking_configurable: true,
    });
    expect(selected).not.toHaveProperty("api_key");
    expect(persisted?.["thinking"]).toEqual({ level: "HIGH" });
  });

  it.each([
    {
      name: "非法用途",
      request: { usage: "unknown", thinking_level: "HIGH" },
    },
    {
      name: "非法思考档位",
      request: { usage: "agent", thinking_level: "UNKNOWN" },
    },
  ])("$name 不落盘", async ({ request }) => {
    const { service } = await create_model_service([create_model({ id: "preset" })]);
    const before = service.get_selection_snapshot();

    expect(() => service.update_selected_model_thinking_level(request)).toThrow(
      "request.validation_failed",
    );
    expect(service.get_selection_snapshot()).toEqual(before);
  });

  it("不可配置思考档位的模型不落盘", async () => {
    const { service } = await create_model_service([
      create_model({ id: "sakura", type: "PRESET", api_format: "SakuraLLM" }),
    ]);
    const before = service.get_selection_snapshot();

    expect(() =>
      service.update_selected_model_thinking_level({ usage: "agent", thinking_level: "HIGH" }),
    ).toThrow("request.validation_failed");
    expect(service.get_selection_snapshot()).toEqual(before);
  });

  it("非法用途和缺失模型均不落盘", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
    ]);
    const before = service.get_selection_snapshot();

    expect(() => service.select_model({ usage: "unknown", model_id: "openai" })).toThrow(
      "request.validation_failed",
    );
    expect(() => service.select_model({ usage: "analysis", model_id: "missing" })).toThrow(
      "model.not_found",
    );

    expect(service.get_selection_snapshot()).toEqual(before);
  });

  it("删除被多个用途引用的模型时统一优先回退同类型模型", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "openai-a", type: "CUSTOM_OPENAI" }),
      create_model({ id: "openai-b", type: "CUSTOM_OPENAI" }),
    ]);
    service.select_model({ usage: "translation", model_id: "openai-a" });
    service.select_model({ usage: "analysis", model_id: "openai-a" });
    service.select_model({ usage: "agent", model_id: "preset" });

    const management_snapshot = read_request_model_snapshot(
      service.delete_model({ model_id: "openai-a" }),
    );
    const selection = read_selection_snapshot(service.get_selection_snapshot());

    expect(selection.model_selection).toEqual({
      translation: "openai-b",
      analysis: "openai-b",
      agent: "preset",
    });
    expect(management_snapshot.models.map((model) => model["id"])).not.toContain("openai-a");
  });

  it("删除已选模型时没有同类型则回退预设，未引用用途保持不变", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
      create_model({ id: "google", type: "CUSTOM_GOOGLE", api_format: "Google" }),
      create_model({ id: "openai", type: "CUSTOM_OPENAI" }),
    ]);
    service.select_model({ usage: "translation", model_id: "google" });
    service.select_model({ usage: "analysis", model_id: "openai" });

    service.delete_model({ model_id: "google" });
    const selection = read_selection_snapshot(service.get_selection_snapshot());

    expect(selection.model_selection).toEqual({
      translation: "preset",
      analysis: "openai",
      agent: "preset",
    });
  });

  it("预设模型和不存在的模型不能删除", async () => {
    const { service } = await create_model_service([
      create_model({ id: "preset", type: "PRESET" }),
    ]);

    expect(() => service.delete_model({ model_id: "preset" })).toThrow("request.validation_failed");
    expect(() => service.delete_model({ model_id: "missing" })).toThrow("model.not_found");
  });

  it("更新模型只应用白名单字段并重建快照", async () => {
    const { service } = await create_model_service([
      create_model({
        agent: { context_window: 288_000, max_output_tokens: 32_000 },
        generation: { temperature: 0.4, temperature_custom_enable: true },
        id: "custom",
        threshold: { input_token_limit: 1024, output_token_limit: 2048 },
        type: "CUSTOM_OPENAI",
      }),
    ]);

    const snapshot = read_request_model_snapshot(
      await service.update_model({
        model_id: "custom",
        patch: {
          agent: { context_window: 300_000 },
          generation: { top_p_custom_enable: true },
          name: "updated-name",
          threshold: { concurrency_limit: 2 },
        },
      }),
    );

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "custom",
          name: "updated-name",
          agent: { context_window: 300_000, max_output_tokens: 32_000 },
          generation: expect.objectContaining({
            temperature: 0.4,
            temperature_custom_enable: true,
            top_p_custom_enable: true,
          }),
          threshold: expect.objectContaining({
            concurrency_limit: 2,
            input_token_limit: 1024,
            output_token_limit: 2048,
          }),
        }),
      ]),
    );
  });

  it("拒绝非法或未知 Agent 容量字段且不落盘", async () => {
    const { service, app_setting_service } = await create_model_service([
      create_model({
        id: "custom",
        agent: { context_window: 288_000, max_output_tokens: 32_000 },
      }),
    ]);
    service.get_snapshot();
    const before = app_setting_service.read_setting();

    expect(() =>
      service.update_model({
        model_id: "custom",
        patch: { agent: { context_window: 64_000 } },
      }),
    ).toThrow("request.validation_failed");
    expect(() =>
      service.update_model({
        model_id: "custom",
        patch: { agent: { context_window: 288_000, unknown: 1 } },
      }),
    ).toThrow("request.validation_failed");
    expect(app_setting_service.read_setting()).toEqual(before);
  });

  it("更新不存在模型或未知字段会返回业务错误", async () => {
    const { service } = await create_model_service([
      create_model({ id: "custom", type: "CUSTOM_OPENAI" }),
    ]);

    expect(() =>
      service.update_model({ model_id: "missing", patch: { name: "updated-name" } }),
    ).toThrow("model.not_found");
    expect(() =>
      service.update_model({ model_id: "custom", patch: { forbidden: "value" } }),
    ).toThrow("request.validation_failed");
    expect(() => service.update_model({ model_id: "custom", patch: { threshold: "bad" } })).toThrow(
      "request.validation_failed",
    );
  });

  it("重置预设模型时从内置预设重新读取目标条目", async () => {
    const { service } = await create_model_service(
      [
        create_model({ id: "other", name: "other-old", type: "PRESET" }),
        create_model({
          id: "target",
          name: "target-old",
          type: "PRESET",
          agent: { context_window: 400_000, max_output_tokens: 50_000 },
        }),
      ],
      {
        builtin_models: [
          create_model({ id: "unmatched", name: "unmatched", type: "PRESET" }),
          create_model({ id: "target", name: "target-updated", type: "PRESET" }),
        ],
      },
    );

    const snapshot = read_request_model_snapshot(
      await service.reset_preset_model({ model_id: "target" }),
    );

    expect(snapshot.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "target",
          name: "target-updated",
          agent: { context_window: 288_000, max_output_tokens: 32_000 },
        }),
        expect.objectContaining({ id: "other", name: "other-old" }),
      ]),
    );
  });

  it("非预设模型和缺失内置条目不能重置", async () => {
    const { service } = await create_model_service([
      create_model({ id: "custom", type: "CUSTOM_OPENAI" }),
      create_model({ id: "preset", type: "PRESET" }),
    ]);

    expect(() => service.reset_preset_model({ model_id: "custom" })).toThrow(
      "request.validation_failed",
    );
    expect(() => service.reset_preset_model({ model_id: "preset" })).toThrow("model.not_found");
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

    const snapshot = read_request_model_snapshot(
      await service.reorder_model({ ordered_model_ids: ["o2", "o3", "o1"] }),
    );

    expect(read_request_model_ids_by_type(snapshot.models, "CUSTOM_OPENAI")).toEqual([
      "o2",
      "o3",
      "o1",
    ]);
    expect(read_request_model_ids_by_type(snapshot.models, "PRESET")).toEqual(["p1"]);
    expect(read_request_model_ids_by_type(snapshot.models, "CUSTOM_GOOGLE")).toEqual(["g1"]);
    expect(read_request_model_ids_by_type(snapshot.models, "CUSTOM_ANTHROPIC")).toEqual(["a1"]);
  });

  it("重排请求必须完整匹配单个模型分组", async () => {
    const { service } = await create_model_service([
      create_model({ id: "a", type: "PRESET" }),
      create_model({ id: "b", type: "CUSTOM_OPENAI" }),
    ]);

    expect(() => service.reorder_model({ ordered_model_ids: [] })).toThrow(
      "request.validation_failed",
    );
    expect(() => service.reorder_model({ ordered_model_ids: ["missing", "b"] })).toThrow(
      "model.not_found",
    );
    expect(() => service.reorder_model({ ordered_model_ids: ["b", "a"] })).toThrow(
      "request.validation_failed",
    );
  });

  it("任务或 Agent 运行期间拒绝全部模型配置写入", async () => {
    const { service, runtime_gate } = await create_model_service([create_model({})]);
    runtime_gate.begin_runtime("agent");

    for (const operation of [
      () => service.update_model({}),
      () => service.select_model({}),
      () => service.update_selected_model_thinking_level({}),
      () => service.add_model({}),
      () => service.delete_model({}),
      () => service.reset_preset_model({}),
      () => service.reorder_model({}),
    ]) {
      expect(operation).toThrow("runtime.busy");
    }
  });
});

describe("ModelService 远端模型能力", () => {
  it("远端列表按 model_id 返回结果并拒绝缺失模型", async () => {
    const { service } = await create_model_service([
      create_model({
        api_format: "OpenAI",
        id: "openai-1",
      }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json_response({ data: [{ id: "model-a" }] })),
    );

    await expect(service.list_available_models({ model_id: "openai-1" })).resolves.toEqual({
      models: ["model-a"],
    });
    await expect(service.list_available_models({ model_id: "missing" })).rejects.toThrow(
      "model.not_found",
    );
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
        input_tokens: 2,
        output_tokens: 3,
        response_result: '{"0":"成功"}',
        response_think: "",
        timeout: false,
      })
      .mockResolvedValueOnce({
        cancelled: false,
        degraded: false,
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
    expect(log_entries.map((entry) => [entry.level, entry.message])).toEqual(
      expect.arrayContaining([
        ["info", "正在测试密钥：\n12345678***bcdefXYZ"],
        ["warning", "接口测试失败 …"],
        ["info", "共测试 2 个接口，成功 1 个，失败 1 个 …"],
        ["warning", "失败的密钥：\n*******"],
      ]),
    );
    expect(log_entries.find((entry) => entry.message === "接口测试失败 …")?.payload).toMatchObject({
      error: {
        message: "请求超时（120 秒）",
      },
      source: "model",
    });
  });
});

async function create_model_service(
  models: Array<JsonRecord>,
  presets: ModelPresetFiles = {},
  log_entries?: LogEntry[],
): Promise<ModelServiceFixture> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-model-service-"));
  cleanup_roots.push(app_root);
  await write_model_presets(app_root, presets);
  const paths = new AppPathService({ appRoot: app_root });
  const app_setting_service = new AppSettingService(paths);
  app_setting_service.save_setting({
    models,
  });
  const log_manager =
    log_entries === undefined
      ? undefined
      : {
          info(message: string, payload?: Record<string, unknown>): void {
            log_entries.push({ level: "info", message, payload });
          },
          warning(message: string, payload?: Record<string, unknown>): void {
            log_entries.push({ level: "warning", message, payload });
          },
        };
  const runtime_gate = new RuntimeOperationGate();
  return {
    app_root,
    paths,
    service: new ModelService(
      paths,
      app_setting_service,
      TEST_LLM_USER_AGENT,
      runtime_gate,
      log_manager,
    ),
    app_setting_service,
    runtime_gate,
  };
}

function create_model(overrides: Partial<JsonRecord>): JsonRecord {
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

async function write_model_presets(app_root: string, presets: ModelPresetFiles): Promise<void> {
  const preset_dir = path.join(app_root, "resource", "model", "preset");
  await mkdir(preset_dir, { recursive: true });
  await writeFile(
    path.join(preset_dir, "preset_model_builtin.json"),
    JSON.stringify(presets.builtin_models ?? []),
    "utf-8",
  );
  await Promise.all(
    Model.custom_types().map((model_type) =>
      writeFile(
        path.join(preset_dir, Model.resolve_template_filename(model_type)),
        JSON.stringify(presets.templates?.[model_type] ?? {}),
        "utf-8",
      ),
    ),
  );
}

function json_response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function create_template(name: string, api_format: string): JsonRecord {
  return {
    api_format,
    api_key: "k",
    api_url: "",
    model_id: "m",
    name,
  };
}

function read_request_model_snapshot(response: JsonRecord): {
  models: Array<JsonRecord>;
} {
  const snapshot = response["snapshot"];
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    throw new Error("测试夹具缺少模型快照");
  }
  const models = snapshot["models"];
  return {
    models: Array.isArray(models)
      ? models.filter(
          (model): model is JsonRecord =>
            typeof model === "object" && model !== null && !Array.isArray(model),
        )
      : [],
  };
}

function read_selection_snapshot(response: JsonRecord): {
  model_selection: { translation: string; analysis: string; agent: string };
  models: Array<JsonRecord>;
} {
  const selection = response["model_selection"];
  const models = response["models"];
  if (typeof selection !== "object" || selection === null || Array.isArray(selection)) {
    throw new Error("测试夹具缺少模型选择");
  }
  return {
    model_selection: {
      translation: String(selection["translation"] ?? ""),
      analysis: String(selection["analysis"] ?? ""),
      agent: String(selection["agent"] ?? ""),
    },
    models: Array.isArray(models)
      ? models.filter(
          (model): model is JsonRecord =>
            typeof model === "object" && model !== null && !Array.isArray(model),
        )
      : [],
  };
}

function read_request_model_ids_by_type(models: Array<JsonRecord>, model_type: string): string[] {
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
