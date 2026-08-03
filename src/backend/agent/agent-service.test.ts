import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProvider,
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type Context,
  type FauxResponseStep,
  type Model,
  type ProviderStreams,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { JsonRecord } from "../../domain/json";
import type { AgentSessionEvent } from "../../shared/agent";
import type { ProjectWriteResult } from "../../shared/project-event";
import { ProjectSessionState } from "../project/project-session-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ComputeWorkerClient } from "../worker/compute-worker-client";

/** 集中保存模型定义与公开快照的共同 skill 身份，避免协议断言复制语言矩阵。 */
const skill_test_fixture = vi.hoisted(() => {
  const snapshots = [
    {
      name: "glossary-audit",
      displayDescriptions: {
        "zh-CN": "审校术语",
        "en-US": "Review glossary",
        "de-DE": "Glossar prüfen",
      },
    },
    {
      name: "corpus-search",
      displayDescriptions: {
        "zh-CN": "检索语料",
        "en-US": "Search corpus",
        "de-DE": "Korpus durchsuchen",
      },
    },
  ];
  return {
    snapshots,
    loader: vi.fn(async () => [
      {
        ...snapshots[0],
        description: "审校术语",
        content: "执行术语审校。",
        filePath: "E:/skills/glossary-audit/SKILL.md",
        disableModelInvocation: false,
        references: [
          {
            path: "references/audit-standard.md",
            filePath: "E:/skills/glossary-audit/references/audit-standard.md",
            content: "# 审校标准\n\n完整正文。",
          },
        ],
      },
      {
        ...snapshots[1],
        description: "检索语料",
        content: "执行语料检索。",
        filePath: "E:/skills/corpus-search/SKILL.md",
        disableModelInvocation: true,
        references: [],
      },
    ]),
  };
});
const system_prompt_loader = vi.hoisted(() => vi.fn(() => "基础系统指令。"));
const session_seed_loader = vi.hoisted(() =>
  vi.fn(() => ({ user: "种子设定。", assistant: "种子确认。" })),
);
const agent_model_registrar = vi.hoisted(() => vi.fn());

const fake_agent_state = vi.hoisted(() => ({
  mode: "success" as
    | "success"
    | "write"
    | "error"
    | "pending"
    | "read_skill"
    | "retry"
    | "streaming"
    | "thinking"
    | "tool_only"
    | "tools",
  abort_count: 0,
  system_prompts: [] as string[],
  prompts: [] as string[],
  model_ids: [] as string[],
  tool_names: [] as string[][],
  release_pending: null as (() => void) | null,
  hold_idle: false,
  hold_tool_write: false,
  release_tool_write: null as (() => void) | null,
  context_window: 288_000,
  max_tokens: 32_000,
  model_call_count: 0,
  retry_failures_remaining: 0,
  summary_failures_remaining: 0,
  request_kinds: [] as Array<"model" | "summary">,
  model_contexts: [] as Context["messages"][],
  auth_configured: true,
  hold_auth: false,
  auth_wait: null as Promise<void> | null,
  release_auth: null as (() => void) | null,
  stream_token_size: 10_000,
  stream_tokens_per_second: undefined as number | undefined,
}));

vi.mock("./agent-skills", () => ({ load_agent_skills: skill_test_fixture.loader }));
vi.mock("./agent-session-seed", async (import_original) => ({
  ...(await import_original<typeof import("./agent-session-seed")>()),
  load_agent_session_seed: session_seed_loader,
}));
vi.mock("./agent-system-prompt", () => ({
  load_agent_system_prompt: system_prompt_loader,
}));
vi.mock("./agent-model", () => ({ register_agent_model: agent_model_registrar }));

import { AgentService } from "./agent-service";

/** 测试只替换远程流边界，Agent 的事件、工具执行、abort 与收尾均使用真实实现。 */
const fake_provider_streams: ProviderStreams = {
  stream: (model, context, options) => create_fake_agent_stream(model, context, options),
  streamSimple: (model, context, options) => create_fake_agent_stream(model, context, options),
};

function create_fake_agent_stream(
  model: Model<any>,
  context: Context,
  options: StreamOptions | undefined,
) {
  const is_summary = context.systemPrompt?.includes("context summarization assistant") === true;
  fake_agent_state.request_kinds.push(is_summary ? "summary" : "model");
  if (!is_summary) {
    fake_agent_state.model_call_count += 1;
    fake_agent_state.model_contexts.push(structuredClone(context.messages));
  }
  fake_agent_state.system_prompts.push(context.systemPrompt ?? "");
  fake_agent_state.prompts.push(read_last_user_text(context));
  fake_agent_state.model_ids.push(model.id);
  fake_agent_state.tool_names.push(context.tools?.map((tool) => tool.name) ?? []);
  const faux = createFauxCore({
    api: model.api,
    provider: model.provider,
    tokenSize: {
      min: fake_agent_state.stream_token_size,
      max: fake_agent_state.stream_token_size,
    },
    tokensPerSecond: fake_agent_state.stream_tokens_per_second,
  });
  const response =
    is_summary && fake_agent_state.summary_failures_remaining > 0
      ? (() => {
          fake_agent_state.summary_failures_remaining -= 1;
          return fauxAssistantMessage([], {
            stopReason: "error",
            errorMessage: "摘要生成失败",
          });
        })()
      : is_summary
        ? fauxAssistantMessage("压缩摘要")
        : create_fake_response(context);
  faux.setResponses([response]);
  return faux.streamSimple(model, context, options);
}

/** 根据测试配置选择模型身份，远程行为统一交给同一个可控流边界。 */
function register_fake_agent_model(
  model_runtime: ModelRuntime,
  config: JsonRecord,
  _user_agent: string,
  frozen_limits?: { contextWindow: number; maxTokens: number },
) {
  const selection = config["model_selection"];
  const selected =
    typeof selection === "object" && selection !== null && !Array.isArray(selection)
      ? Reflect.get(selection, "agent")
      : undefined;
  const model_id = selected === "next" ? "next-model" : "test-model";
  const limits = frozen_limits ?? {
    contextWindow: fake_agent_state.context_window,
    maxTokens: fake_agent_state.max_tokens,
  };
  const model = {
    id: model_id,
    name: model_id,
    api: "faux",
    provider: "faux",
    baseUrl: "http://localhost:0",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
  };
  model_runtime.registerNativeProvider(
    createProvider({
      id: "faux",
      auth: {
        apiKey: {
          name: "测试 Provider",
          resolve: async () => {
            if (fake_agent_state.hold_auth) {
              if (fake_agent_state.auth_wait === null) {
                fake_agent_state.auth_wait = new Promise<void>((resolve) => {
                  fake_agent_state.release_auth = () => {
                    fake_agent_state.hold_auth = false;
                    fake_agent_state.auth_wait = null;
                    fake_agent_state.release_auth = null;
                    resolve();
                  };
                });
              }
              await fake_agent_state.auth_wait;
            }
            return fake_agent_state.auth_configured
              ? { auth: { headers: {} }, source: "测试 Provider" }
              : undefined;
          },
        },
      },
      models: [model],
      api: fake_provider_streams,
    }),
  );
  return { model, thinkingLevel: "off" as const };
}

/** 只描述模型响应，不复制 Agent 的事件协议、工具执行或生命周期。 */
function create_fake_response(context: Context): FauxResponseStep {
  if (fake_agent_state.mode === "pending") {
    return async (_context, options) => await wait_for_pending_release(options?.signal);
  }
  const after_tool_call = context.messages.at(-1)?.role === "toolResult";
  if (after_tool_call) {
    return fauxAssistantMessage(fake_agent_state.mode === "tools" ? "查询完成" : []);
  }
  if (fake_agent_state.mode === "error") {
    return fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "request failed",
    });
  }
  if (fake_agent_state.mode === "retry" && fake_agent_state.retry_failures_remaining > 0) {
    fake_agent_state.retry_failures_remaining -= 1;
    return fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "overloaded_error",
    });
  }
  if (fake_agent_state.mode === "thinking") {
    return fauxAssistantMessage([
      {
        type: "thinking",
        thinking: "检查术语\n",
        thinkingSignature: "private-visible",
      },
      { type: "thinking", thinking: "    " },
      { type: "thinking", thinking: "逐项核对" },
      {
        type: "thinking",
        thinking: "",
        thinkingSignature: "private-redacted",
        redacted: true,
      },
      fauxText("已完成"),
    ]);
  }
  if (fake_agent_state.mode === "streaming") {
    return fauxAssistantMessage("abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx");
  }
  if (fake_agent_state.mode === "write") {
    return fauxAssistantMessage(
      fauxToolCall(
        "update_quality_rules",
        {
          rule_type: "glossary",
          meta: { enabled: false },
          expected_section_revisions: { quality: 3 },
        },
        { id: "write-1" },
      ),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "tool_only") {
    return fauxAssistantMessage(
      fauxToolCall("query_items", { search: { keyword: "Alice" } }, { id: "tool-only" }),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "tools") {
    return fauxAssistantMessage(
      [
        fauxText("准备查询"),
        fauxToolCall("query_items", { search: { keyword: "Alice" } }, { id: "tool-1" }),
        fauxToolCall(
          "read_skill",
          { path: "E:/skills/glossary-audit/references/audit-standard.md" },
          { id: "tool-2" },
        ),
      ],
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "read_skill") {
    const prompt = read_last_user_text(context);
    const calls = prompt.includes('<skill name="corpus-search"')
      ? [
          fauxToolCall(
            "read_skill",
            { path: "E:/skills/corpus-search/SKILL.md" },
            { id: "manual-after-invocation" },
          ),
        ]
      : [
          fauxToolCall(
            "read_skill",
            { path: "E:/skills/glossary-audit/SKILL.md" },
            { id: "auto-root" },
          ),
          fauxToolCall(
            "read_skill",
            { path: "E:/skills/glossary-audit/references/audit-standard.md" },
            { id: "auto-reference" },
          ),
          fauxToolCall(
            "read_skill",
            { path: "E:/skills/corpus-search/SKILL.md" },
            { id: "manual-before-invocation" },
          ),
        ];
    return fauxAssistantMessage(calls, { stopReason: "toolUse" });
  }
  return fauxAssistantMessage("已完成");
}

function read_last_user_text(context: Context): string {
  const message = context.messages.findLast((candidate) => candidate.role === "user");
  if (message?.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("");
}

/** pending 响应可选择在 abort 后继续占住，用于验证 reset/dispose 的真实收尾屏障。 */
function wait_for_pending_release(signal: AbortSignal | undefined): Promise<AssistantMessage> {
  return new Promise((resolve) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handle_abort);
      if (fake_agent_state.release_pending === release) {
        fake_agent_state.release_pending = null;
      }
      resolve(fauxAssistantMessage("已完成"));
    };
    const handle_abort = () => {
      fake_agent_state.abort_count += 1;
      if (!fake_agent_state.hold_idle) release();
    };
    fake_agent_state.release_pending = release;
    if (signal?.aborted === true) handle_abort();
    else signal?.addEventListener("abort", handle_abort, { once: true });
  });
}

describe("AgentService", () => {
  const services: AgentService[] = [];

  beforeEach(() => {
    fake_agent_state.mode = "success";
    fake_agent_state.abort_count = 0;
    fake_agent_state.system_prompts = [];
    fake_agent_state.prompts = [];
    fake_agent_state.model_ids = [];
    fake_agent_state.tool_names = [];
    fake_agent_state.release_pending = null;
    fake_agent_state.hold_idle = false;
    fake_agent_state.hold_tool_write = false;
    fake_agent_state.release_tool_write = null;
    fake_agent_state.context_window = 288_000;
    fake_agent_state.max_tokens = 32_000;
    fake_agent_state.model_call_count = 0;
    fake_agent_state.retry_failures_remaining = 0;
    fake_agent_state.summary_failures_remaining = 0;
    fake_agent_state.request_kinds = [];
    fake_agent_state.model_contexts = [];
    fake_agent_state.auth_configured = true;
    fake_agent_state.hold_auth = false;
    fake_agent_state.auth_wait = null;
    fake_agent_state.release_auth = null;
    fake_agent_state.stream_token_size = 10_000;
    fake_agent_state.stream_tokens_per_second = undefined;
    agent_model_registrar.mockReset();
    agent_model_registrar.mockImplementation(register_fake_agent_model);
    skill_test_fixture.loader.mockClear();
    system_prompt_loader.mockClear();
    session_seed_loader.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fake_agent_state.hold_idle = false;
    fake_agent_state.release_auth?.();
    fake_agent_state.release_tool_write?.();
    fake_agent_state.release_pending?.();
    await Promise.all(services.splice(0).map(async (service) => await service.dispose()));
  });

  it("快照下发启动期 skill 清单，旧协议、未知和重复 skill 均在变更状态前拒绝", async () => {
    const fixture = await create_service();

    expect(fixture.service.get_snapshot().skills).toEqual(skill_test_fixture.snapshots);
    await expect(fixture.service.send_message({ text: "旧协议" })).rejects.toThrow(
      "request.validation_failed",
    );
    await expect(
      fixture.service.send_message({ parts: [{ kind: "skill", name: "missing" }] }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      fixture.service.send_message({
        parts: [
          { kind: "skill", name: "glossary-audit" },
          { kind: "skill", name: "glossary-audit" },
        ],
      }),
    ).rejects.toThrow("request.validation_failed");
    expect(fixture.service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
  });

  it("skill 快照复制 UI 描述，不向调用方暴露内部资源引用", async () => {
    const fixture = await create_service();
    const expected_skills = structuredClone(skill_test_fixture.snapshots);
    const snapshot = fixture.service.get_snapshot();

    snapshot.skills[0]!.displayDescriptions["en-US"] = "污染外部快照";

    expect(fixture.service.get_snapshot().skills).toEqual(expected_skills);
  });

  it("新对话把一问一答种子放在模型历史最前且不公开到时间线", async () => {
    const fixture = await create_service();

    await fixture.service.send_message({ parts: [{ kind: "text", text: "正文" }] });
    await wait_for_idle(fixture.service);

    const context = fake_agent_state.model_contexts[0] ?? [];
    expect(context[0]).toMatchObject({ role: "user", content: "种子设定。" });
    expect(context[1]).toMatchObject({ role: "assistant" });
    expect(JSON.stringify(context[1])).toContain("种子确认。");
    expect(context[2]?.role).toBe("user");
    expect(JSON.stringify(context[2])).toContain("正文");
    const entries = fixture.service.get_snapshot().entries;
    expect(entries[0]).toMatchObject({
      kind: "user_message",
      parts: [{ kind: "text", text: "正文" }],
    });
    expect(JSON.stringify(entries)).not.toContain("种子设定。");
  });

  it("按引用顺序展开多个 skill，并把混排可见文本追加到模型用户消息", async () => {
    const fixture = await create_service();

    await fixture.service.send_message({
      parts: [
        { kind: "text", text: "先用 " },
        { kind: "skill", name: "corpus-search" },
        { kind: "text", text: "，再用 " },
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "。" },
      ],
    });
    await wait_for_idle(fixture.service);
    const prompt = fake_agent_state.prompts.at(-1) ?? "";

    expect(prompt.indexOf('name="corpus-search"')).toBeLessThan(
      prompt.indexOf('name="glossary-audit"'),
    );
    expect(prompt).toContain("先用 @corpus-search，再用 @glossary-audit。");
    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(prompt).not.toContain("完整正文。");
  });

  it("仅含 skill 的消息只发送 skill block，不补通用用户指令", async () => {
    const fixture = await create_service();

    await fixture.service.send_message({
      parts: [{ kind: "skill", name: "glossary-audit" }],
    });
    await wait_for_idle(fixture.service);

    expect(fake_agent_state.prompts.at(-1)).toMatch(/^<skill name="glossary-audit"/u);
    expect(fake_agent_state.prompts.at(-1)).not.toContain("@glossary-audit");
  });

  it("模型回合从 running 回到 idle，并由条目保存成功终态", async () => {
    const { service, publish } = await create_service();

    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    expect(service.get_snapshot().state).toBe("running");
    expect(service.get_snapshot().entries[0]).toMatchObject({
      kind: "user_message",
      endedAt: null,
    });
    await wait_for_idle(service);

    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(service.get_snapshot()).toMatchObject({
      state: "idle",
      entries: [
        {
          kind: "user_message",
          parts: [{ kind: "text", text: "开始" }],
          status: "success",
          endedAt: expect.any(Number),
        },
        {
          kind: "assistant_message",
          parts: [{ kind: "text", text: "已完成" }],
          status: "success",
        },
      ],
    });
    const round_end_index = publish.mock.calls.findIndex(([, event]) => {
      const entry = event["entry"];
      return (
        event["type"] === "entry_upsert" &&
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as JsonRecord)["kind"] === "user_message" &&
        typeof (entry as JsonRecord)["endedAt"] === "number"
      );
    });
    const idle_index = publish.mock.calls.findIndex(
      ([, event]) => event["type"] === "session_state" && event["state"] === "idle",
    );
    expect(round_end_index).toBeGreaterThan(-1);
    expect(idle_index).toBeGreaterThan(round_end_index);
  });

  it("高频 assistant delta 按固定窗口合并，并立即发布完整终帧", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { service, publish } = await create_service();
    const published_at: number[] = [];
    publish.mockImplementation(() => {
      published_at.push(Date.now());
    });
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 40;

    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await vi.runAllTimersAsync();
    await wait_for_idle(service);

    const assistant_events = publish.mock.calls.flatMap(([, payload], index) => {
      const event = payload as AgentSessionEvent;
      return event.type === "entry_upsert" && event.entry.kind === "assistant_message"
        ? [{ entry: event.entry, publishedAt: published_at[index] }]
        : [];
    });
    const running_events = assistant_events.filter(({ entry }) => entry.status === "running");
    const final_text = "abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx";

    expect(running_events.length).toBeGreaterThan(0);
    expect(running_events.length).toBeLessThan(12);
    expect(
      running_events
        .slice(1)
        .every(
          (event, index) =>
            event.publishedAt !== undefined &&
            running_events[index]?.publishedAt !== undefined &&
            event.publishedAt - running_events[index].publishedAt >= 100,
        ),
    ).toBe(true);
    expect(
      running_events.every(
        ({ entry }) =>
          entry.kind === "assistant_message" &&
          entry.parts.length === 1 &&
          entry.parts[0]?.kind === "text" &&
          final_text.startsWith(entry.parts[0].text),
      ),
    ).toBe(true);
    expect(
      running_events
        .slice(1)
        .every(
          ({ entry }, index) =>
            entry.kind === "assistant_message" &&
            running_events[index]?.entry.kind === "assistant_message" &&
            entry.parts[0]!.text.length >= running_events[index].entry.parts[0]!.text.length,
        ),
    ).toBe(true);
    expect(new Set(assistant_events.map(({ entry }) => entry.id))).toHaveProperty("size", 1);
    expect(assistant_events.at(-1)?.entry).toMatchObject({
      kind: "assistant_message",
      parts: [{ kind: "text", text: final_text }],
      status: "success",
    });

    const final_assistant_index = publish.mock.calls.findLastIndex(([, payload]) => {
      const event = payload as AgentSessionEvent;
      return (
        event.type === "entry_upsert" &&
        event.entry.kind === "assistant_message" &&
        event.entry.status === "success"
      );
    });
    const final_user_index = publish.mock.calls.findLastIndex(([, payload]) => {
      const event = payload as AgentSessionEvent;
      return (
        event.type === "entry_upsert" &&
        event.entry.kind === "user_message" &&
        event.entry.status === "success"
      );
    });
    const idle_index = publish.mock.calls.findLastIndex(([, payload]) => {
      const event = payload as AgentSessionEvent;
      return event.type === "session_state" && event.state === "idle";
    });
    expect(final_user_index).toBeGreaterThan(final_assistant_index);
    expect(idle_index).toBeGreaterThan(final_user_index);
    expect(service.get_snapshot().entries.at(-1)).toEqual(assistant_events.at(-1)?.entry);
  });

  it("从真实 Agent 消息历史发布上下文用量，并在重置时清空", async () => {
    const { service, publish } = await create_service();
    expect(service.get_snapshot().contextUsage).toBeNull();

    await service.send_message({ parts: [{ kind: "text", text: "x".repeat(400) }] });
    await wait_for_idle(service);

    const context_events = publish.mock.calls
      .map(([, event]) => event)
      .filter((event) => event["type"] === "context_usage");
    expect(context_events[0]).toEqual({
      type: "context_usage",
      contextUsage: {
        tokens: expect.any(Number),
        contextWindow: 288_000,
        maxTokens: 32_000,
      },
    });
    expect(service.get_snapshot().contextUsage).toMatchObject({
      tokens: expect.any(Number),
      contextWindow: 288_000,
      maxTokens: 32_000,
    });
    expect(service.get_snapshot().contextUsage?.tokens).toBeGreaterThan(0);
    expect(context_events.at(-1)?.["contextUsage"]).toEqual(service.get_snapshot().contextUsage);

    await expect(service.reset()).resolves.toMatchObject({ contextUsage: null });
    expect(publish).toHaveBeenLastCalledWith("agent.session_event", {
      type: "snapshot_seed",
      snapshot: service.get_snapshot(),
    });
  });

  it("同一对话冻结容量并在重置后的新对话读取最新设置", async () => {
    const { service } = await create_service();
    await service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    await wait_for_idle(service);

    fake_agent_state.context_window = 400_000;
    fake_agent_state.max_tokens = 50_000;
    await service.send_message({ parts: [{ kind: "text", text: "第二轮" }] });
    await wait_for_idle(service);
    expect(service.get_snapshot().contextUsage).toMatchObject({
      contextWindow: 288_000,
      maxTokens: 32_000,
    });

    await service.reset();
    await service.send_message({ parts: [{ kind: "text", text: "新对话" }] });
    await wait_for_idle(service);
    expect(service.get_snapshot().contextUsage).toMatchObject({
      contextWindow: 400_000,
      maxTokens: 50_000,
    });
  });

  it("按上游顺序流式公开思考与正文，并隔离脱敏内容和签名", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "thinking";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 10;

    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await vi.runAllTimersAsync();
    await wait_for_idle(service);
    const snapshot = service.get_snapshot();

    expect(snapshot.entries.at(-1)).toMatchObject({
      kind: "assistant_message",
      parts: [
        { kind: "thinking", text: "检查术语\n逐项核对" },
        { kind: "text", text: "已完成" },
      ],
      status: "success",
    });
    const running_assistant_entries = publish.mock.calls.flatMap(([, payload]) => {
      const event = payload as AgentSessionEvent;
      return event.type === "entry_upsert" &&
        event.entry.kind === "assistant_message" &&
        event.entry.status === "running"
        ? [event.entry]
        : [];
    });
    expect(running_assistant_entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parts: [{ kind: "thinking", text: "检查术语\n逐项核对" }],
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain("private-visible");
    expect(JSON.stringify(snapshot)).not.toContain("private-redacted");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("private-visible");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("private-redacted");
  });

  it("纯工具调用消息不产生空 assistant 条目", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "tool_only";

    await service.send_message({ parts: [{ kind: "text", text: "查询" }] });
    await wait_for_idle(service);

    expect(service.get_snapshot().entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "tool_call",
    ]);
  });

  it("工具执行体在 running 事件获得发送轮次后才开始", async () => {
    const { service, publish, read_items } = await create_service();
    fake_agent_state.mode = "tool_only";
    let running_event_send_turn_completed = false;
    let tool_started_before_running_turn = false;
    // publish 的下一轮代表本地 SSE 获得写出机会；工具执行体不得抢在它之前。
    publish.mockImplementation((_topic, payload) => {
      const event = payload as AgentSessionEvent;
      if (
        event.type === "entry_upsert" &&
        event.entry.kind === "tool_call" &&
        event.entry.status === "running"
      ) {
        setImmediate(() => {
          running_event_send_turn_completed = true;
        });
      }
    });
    read_items.mockImplementation(() => {
      tool_started_before_running_turn = !running_event_send_turn_completed;
      return [];
    });

    await service.send_message({ parts: [{ kind: "text", text: "查询" }] });
    await wait_for_idle(service);

    expect(tool_started_before_running_turn).toBe(false);
    expect(read_items).toHaveBeenCalledOnce();
  });

  it("模型回合按 user、assistant、tool_call、assistant 的真实时序追加条目", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "tools";

    await service.send_message({ parts: [{ kind: "text", text: "查询" }] });
    await wait_for_idle(service);
    const snapshot = service.get_snapshot();

    expect(publish).toHaveBeenCalledWith(
      "agent.session_event",
      expect.objectContaining({
        type: "entry_upsert",
        entry: expect.objectContaining({
          kind: "tool_call",
          id: "tool-1",
          status: "running",
          toolName: "query_items",
          output: null,
        }),
      }),
    );
    expect(snapshot.entries).toEqual([
      {
        kind: "user_message",
        id: expect.any(String),
        parts: [{ kind: "text", text: "查询" }],
        status: "success",
        createdAt: expect.any(Number),
        endedAt: expect.any(Number),
      },
      {
        kind: "assistant_message",
        id: expect.any(String),
        parts: [{ kind: "text", text: "准备查询" }],
        status: "success",
        createdAt: expect.any(Number),
      },
      {
        kind: "tool_call",
        id: "tool-1",
        toolName: "query_items",
        status: "success",
        output: expect.stringContaining('"items"'),
        createdAt: expect.any(Number),
      },
      {
        kind: "tool_call",
        id: "tool-2",
        toolName: "read_skill",
        status: "success",
        output: expect.stringContaining("完整正文。"),
        createdAt: expect.any(Number),
      },
      {
        kind: "assistant_message",
        id: expect.any(String),
        parts: [{ kind: "text", text: "查询完成" }],
        status: "success",
        createdAt: expect.any(Number),
      },
    ]);
    const published_tool_entries = publish.mock.calls
      .flatMap(([, payload]) => {
        const entry = payload["entry"];
        return typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? [entry as JsonRecord]
          : [];
      })
      .filter((entry) => entry["kind"] === "tool_call");
    expect(published_tool_entries).toHaveLength(4);
    expect(
      published_tool_entries.every(
        (entry) => !("args" in entry) && !("details" in entry) && "output" in entry,
      ),
    ).toBe(true);
    const published_events = publish.mock.calls.map(([, payload]) => payload);
    const first_tool_success_index = published_events.findIndex((event) => {
      const entry = event["entry"];
      return (
        event["type"] === "entry_upsert" &&
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as JsonRecord)["kind"] === "tool_call" &&
        (entry as JsonRecord)["status"] === "success"
      );
    });
    const next_assistant_index = published_events.findIndex((event, index) => {
      const entry = event["entry"];
      return (
        index > first_tool_success_index &&
        event["type"] === "entry_upsert" &&
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as JsonRecord)["kind"] === "assistant_message"
      );
    });
    const tool_result_usage_index = published_events.findIndex(
      (event, index) =>
        index > first_tool_success_index &&
        index < next_assistant_index &&
        event["type"] === "context_usage",
    );
    expect(first_tool_success_index).toBeGreaterThan(-1);
    expect(next_assistant_index).toBeGreaterThan(first_tool_success_index);
    expect(tool_result_usage_index).toBeGreaterThan(first_tool_success_index);
  });

  it("真实 Agent 将流终态错误封口到轮次，并让 prompt 正常结束", async () => {
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "error";

    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await wait_for_idle(service);

    expect(log_error).toHaveBeenCalledWith(
      "Agent 模型回合失败",
      expect.objectContaining({
        source: "agent",
        error: expect.objectContaining({ message: "request failed" }),
      }),
    );
    expect(service.get_snapshot()).toMatchObject({
      state: "idle",
      entries: [
        {
          kind: "user_message",
          parts: [{ kind: "text", text: "开始" }],
          status: "error",
          endedAt: expect.any(Number),
        },
      ],
    });
  });

  it("同一工程事实变化后保留历史并继续原会话", async () => {
    const { service, publish, change_project_facts } = await create_service();

    await service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    await wait_for_idle(service);
    change_project_facts();
    await service.send_message({ parts: [{ kind: "text", text: "第二轮" }] });
    await wait_for_idle(service);

    expect(
      service.get_snapshot().entries.filter((entry) => entry.kind === "user_message"),
    ).toHaveLength(2);
    expect(JSON.stringify(fake_agent_state.model_contexts.at(-1))).toContain("第一轮");
    expect(count_published_events(publish, "snapshot_seed")).toBe(0);
  });

  it("工程会话切换仍清空会话", async () => {
    const { service, publish, session_state } = await create_service();

    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await wait_for_idle(service);
    await session_state.mark_loaded("next.lg");

    expect(service.get_snapshot()).toEqual({
      state: "idle",
      entries: [],
      skills: skill_test_fixture.snapshots,
      contextUsage: null,
    });
    expect(count_published_events(publish, "snapshot_seed")).toBe(1);
  });

  it("真实 Agent 仅注册产品工具并保留写入时间线", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "write";

    await service.send_message({
      parts: [
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "写入" },
      ],
    });
    await wait_for_idle(service);
    expect(fake_agent_state.tool_names.at(-1)).toEqual([
      "query_quality_rules",
      "update_quality_rules",
      "query_items",
      "query_warning_items",
      "update_items",
      "read_skill",
    ]);
    expect(service.get_snapshot().entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "tool_call",
    ]);
  });

  it("停止会中断当前回合并回到 idle，主动 abort 不上报请求失败", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(13_500);
    const stopped_snapshot = service.stop();
    expect(stopped_snapshot).toMatchObject({
      state: "idle",
      entries: [{ kind: "user_message", createdAt: 1_000, endedAt: 13_500 }],
    });
    expect(stopped_snapshot.contextUsage).toMatchObject({
      contextWindow: 288_000,
      maxTokens: 32_000,
    });
    expect(fake_agent_state.abort_count).toBe(1);
    await service.dispose();
    expect(log_error).not.toHaveBeenCalled();
  });

  it("停止会冲刷窗口内最新正文并阻止迟到 running 帧", async () => {
    vi.useFakeTimers();
    const { service, publish, log_error } = await create_service();
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 40;

    await service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await vi.advanceTimersByTimeAsync(25);
    const stopped_snapshot = service.stop();
    const stopped_assistant = stopped_snapshot.entries.find(
      (entry) => entry.kind === "assistant_message",
    );

    expect(stopped_assistant).toMatchObject({
      kind: "assistant_message",
      parts: [{ kind: "text", text: "abcd" }],
      status: "stopped",
    });
    expect(stopped_snapshot).toMatchObject({
      state: "idle",
      entries: [
        expect.objectContaining({
          kind: "user_message",
          status: "stopped",
          endedAt: expect.any(Number),
        }),
        expect.objectContaining({ kind: "assistant_message", status: "stopped" }),
      ],
    });
    const stopped_index = publish.mock.calls.findLastIndex(([, payload]) => {
      const event = payload as AgentSessionEvent;
      return (
        event.type === "entry_upsert" &&
        event.entry.kind === "assistant_message" &&
        event.entry.status === "stopped"
      );
    });

    await vi.runAllTimersAsync();

    expect(
      publish.mock.calls.slice(stopped_index + 1).some(([, payload]) => {
        const event = payload as AgentSessionEvent;
        return (
          event.type === "entry_upsert" &&
          event.entry.kind === "assistant_message" &&
          event.entry.status === "running"
        );
      }),
    ).toBe(false);
    expect(
      service.get_snapshot().entries.find((entry) => entry.id === stopped_assistant?.id),
    ).toEqual(stopped_assistant);
    expect(log_error).not.toHaveBeenCalled();
  });

  it("停止会先封口运行中的工具，迟到的工具结果不能改写历史", async () => {
    const { service, runtime_gate } = await create_service();
    fake_agent_state.mode = "write";
    fake_agent_state.hold_tool_write = true;
    await service.send_message({ parts: [{ kind: "text", text: "写入" }] });
    await vi.waitFor(() => {
      expect(service.get_snapshot().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "tool_call", id: "write-1", status: "running" }),
        ]),
      );
    });

    const stopped_entries = service.stop().entries;
    expect(stopped_entries).toEqual([
      expect.objectContaining({
        kind: "user_message",
        status: "stopped",
        endedAt: expect.any(Number),
      }),
      expect.objectContaining({ kind: "tool_call", id: "write-1", status: "stopped" }),
    ]);

    fake_agent_state.release_tool_write?.();
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
    expect(service.get_snapshot().entries).toEqual(stopped_entries);
  });

  it("SDK preflight 尚未结束时 stop 也不会迟到启动模型请求", async () => {
    const { service, log_error } = await create_service();
    fake_agent_state.hold_auth = true;
    await service.send_message({ parts: [{ kind: "text", text: "立即停止" }] });
    await vi.waitFor(() => expect(fake_agent_state.release_auth).not.toBeNull());

    expect(service.stop()).toMatchObject({ state: "idle" });
    fake_agent_state.release_auth?.();
    await vi.waitFor(() => expect(fake_agent_state.release_auth).toBeNull());
    await Promise.resolve();

    expect(fake_agent_state.model_call_count).toBe(0);
    expect(log_error).not.toHaveBeenCalled();
  });

  it("reset 会立即隔离并等待 SDK preflight 真正 settle", async () => {
    const { service } = await create_service();
    fake_agent_state.hold_auth = true;
    await service.send_message({ parts: [{ kind: "text", text: "立即重置" }] });
    await vi.waitFor(() => expect(fake_agent_state.release_auth).not.toBeNull());

    let settled = false;
    const resetting = service.reset().then((snapshot) => {
      settled = true;
      return snapshot;
    });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    await Promise.resolve();
    expect(settled).toBe(false);

    fake_agent_state.release_auth?.();
    await expect(resetting).resolves.toMatchObject({ state: "idle", entries: [] });
    expect(fake_agent_state.model_call_count).toBe(0);
  });

  it("运行中重置立即隔离旧会话，并在旧回合退出后创建全新上下文", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    await service.send_message({
      parts: [
        { kind: "skill", name: "corpus-search" },
        { kind: "text", text: "旧任务" },
      ],
    });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());

    let settled = false;
    const resetting = service.reset().then((snapshot) => {
      settled = true;
      return snapshot;
    });
    expect(fake_agent_state.abort_count).toBe(1);
    expect(service.get_snapshot()).toEqual({
      state: "idle",
      entries: [],
      skills: skill_test_fixture.snapshots,
      contextUsage: null,
    });
    expect(publish).toHaveBeenLastCalledWith("agent.session_event", {
      type: "snapshot_seed",
      snapshot: service.get_snapshot(),
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    let resetting_error: unknown;
    try {
      await service.send_message({ parts: [{ kind: "text", text: "过早的新任务" }] });
    } catch (error) {
      resetting_error = error;
    }
    expect(resetting_error).toMatchObject({
      code: "runtime.busy",
    });
    expect(service.get_snapshot().entries).toEqual([]);

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_pending?.();
    await expect(resetting).resolves.toMatchObject({ state: "idle", entries: [] });
    fake_agent_state.mode = "success";
    await service.send_message({ parts: [{ kind: "text", text: "新任务" }] });
    await wait_for_idle(service);

    expect(service.get_snapshot().entries.filter((entry) => entry.kind === "user_message")).toEqual(
      [expect.objectContaining({ parts: [{ kind: "text", text: "新任务" }] })],
    );
  });

  it("reset 丢弃窗口内 pending 正文且不发布迟到事件", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 40;

    await service.send_message({ parts: [{ kind: "text", text: "旧任务" }] });
    await vi.advanceTimersByTimeAsync(25);
    const resetting = service.reset();
    const seed_index = publish.mock.calls.findLastIndex(
      ([, payload]) => payload["type"] === "snapshot_seed",
    );

    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    expect(seed_index).toBeGreaterThan(-1);
    await vi.runAllTimersAsync();
    await expect(resetting).resolves.toMatchObject({ state: "idle", entries: [] });
    expect(
      publish.mock.calls.slice(seed_index + 1).some(([, payload]) => {
        const event = payload as AgentSessionEvent;
        return event.type === "entry_upsert" && event.entry.kind === "assistant_message";
      }),
    ).toBe(false);
  });

  it("dispose 清理 pending timer 且不再发布事件", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 40;

    await service.send_message({ parts: [{ kind: "text", text: "旧任务" }] });
    await vi.advanceTimersByTimeAsync(25);
    const disposing = service.dispose();
    const publish_count = publish.mock.calls.length;

    await vi.runAllTimersAsync();
    await disposing;
    expect(publish).toHaveBeenCalledTimes(publish_count);
  });

  it("dispose 等待已经脱离 runtime 的重置收尾", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    await service.send_message({ parts: [{ kind: "text", text: "旧任务" }] });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    const resetting = service.reset();

    let disposed = false;
    const disposing = service.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_pending?.();
    await Promise.all([resetting, disposing]);
    expect(disposed).toBe(true);
  });

  it("skill 进入消息历史后，后续普通回合仍使用稳定基础 system prompt", async () => {
    const { service } = await create_service();

    await service.send_message({
      parts: [
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "审校" },
      ],
    });
    await wait_for_idle(service);
    await service.send_message({ parts: [{ kind: "text", text: "普通对话" }] });
    await wait_for_idle(service);

    expect(fake_agent_state.system_prompts.at(-1)).toBe(fake_agent_state.system_prompts.at(-2));
    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(fake_agent_state.prompts.at(-2)).toContain("执行术语审校。");
    expect(fake_agent_state.prompts.at(-1)).toBe("普通对话");
  });

  it("空闲回合之间重绑定 Agent 模型并保留历史", async () => {
    const { service, select_agent_model } = await create_service();

    await service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    await wait_for_idle(service);
    select_agent_model("next");
    await service.send_message({ parts: [{ kind: "text", text: "第二轮" }] });
    await wait_for_idle(service);

    expect(fake_agent_state.model_ids).toEqual(["test-model", "next-model"]);
    expect(
      service.get_snapshot().entries.filter((entry) => entry.kind === "user_message"),
    ).toHaveLength(2);
  });

  it("建会话准备失败时不公开用户条目、状态或模型请求", async () => {
    const { service, publish } = await create_service();
    agent_model_registrar.mockImplementationOnce(() => {
      throw new Error("模型解析失败");
    });
    const before = service.get_snapshot();

    await expect(
      service.send_message({ parts: [{ kind: "text", text: "不会受理" }] }),
    ).rejects.toThrow("模型解析失败");

    expect(service.get_snapshot()).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
    expect(fake_agent_state.model_call_count).toBe(0);
  });

  it("换模鉴权失败时保留原公开快照", async () => {
    const { service, select_agent_model } = await create_service();
    await service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    await wait_for_idle(service);
    const before = service.get_snapshot();
    select_agent_model("next");
    fake_agent_state.auth_configured = false;

    await expect(
      service.send_message({ parts: [{ kind: "text", text: "不会追加" }] }),
    ).rejects.toThrow("No API key");

    expect(service.get_snapshot()).toEqual(before);
    expect(fake_agent_state.model_call_count).toBe(1);
  });

  it("创建运行时期间 stop 会令候选失效且不产生公开受理事实", async () => {
    const { service } = await create_service();

    const sending = service.send_message({ parts: [{ kind: "text", text: "不会启动" }] });
    expect(service.stop()).toMatchObject({ state: "idle", entries: [] });

    await expect(sending).rejects.toMatchObject({
      diagnostic_context: { reason: "agent_message_invalidated" },
    });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    expect(fake_agent_state.model_call_count).toBe(0);
  });

  it("换模期间 stop 会关闭候选运行时并保留既有公开历史", async () => {
    const { service, select_agent_model } = await create_service();
    await service.send_message({ parts: [{ kind: "text", text: "既有历史" }] });
    await wait_for_idle(service);
    const entries_before = service.get_snapshot().entries;
    select_agent_model("next");
    fake_agent_state.hold_auth = true;

    const switching = service.send_message({ parts: [{ kind: "text", text: "不会受理" }] });
    await vi.waitFor(() => expect(fake_agent_state.release_auth).not.toBeNull());
    expect(service.stop()).toMatchObject({ state: "idle", entries: entries_before });
    fake_agent_state.release_auth?.();

    await expect(switching).rejects.toMatchObject({
      diagnostic_context: { reason: "agent_message_invalidated" },
    });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: entries_before });
    expect(fake_agent_state.model_call_count).toBe(1);
  });

  it("首次过载后自动重试成功，不公开中间失败", async () => {
    vi.useFakeTimers();
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "retry";
    fake_agent_state.retry_failures_remaining = 1;

    await service.send_message({ parts: [{ kind: "text", text: "重试" }] });
    await vi.runAllTimersAsync();
    await wait_for_idle(service);

    expect(fake_agent_state.model_call_count).toBe(2);
    expect(service.get_snapshot().entries.at(-1)).toMatchObject({
      kind: "assistant_message",
      parts: [{ kind: "text", text: "已完成" }],
      status: "success",
    });
    expect(log_error).not.toHaveBeenCalled();
  });

  it("重试等待期间 stop 会取消后续调用且不报告失败", async () => {
    vi.useFakeTimers();
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "retry";
    fake_agent_state.retry_failures_remaining = 1;
    await service.send_message({ parts: [{ kind: "text", text: "取消重试" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake_agent_state.model_call_count).toBe(1);

    expect(service.stop()).toMatchObject({ state: "idle" });
    await vi.runAllTimersAsync();

    expect(fake_agent_state.model_call_count).toBe(1);
    expect(log_error).not.toHaveBeenCalled();
  });

  it("高用量回答触发阈值压缩，公开时间线不缩水且下一轮从摘要继续", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.context_window = 65_001;
    for (const round of [1, 2, 3, 4, 5]) {
      await service.send_message({
        parts: [{ kind: "text", text: `第${round.toString()}轮${"x".repeat(40_000)}` }],
      });
      await wait_for_idle(service);
    }
    const after_compaction = service.get_snapshot();
    const usage_tokens = publish.mock.calls.flatMap(([, event]) =>
      event["type"] === "context_usage"
        ? [Number((event["contextUsage"] as JsonRecord)["tokens"])]
        : [],
    );

    expect(fake_agent_state.request_kinds).toContain("summary");
    expect(after_compaction.entries).toHaveLength(10);

    await service.send_message({ parts: [{ kind: "text", text: "继续" }] });
    await wait_for_idle(service);
    const next_context = fake_agent_state.model_contexts.at(-1);
    expect(JSON.stringify(next_context?.[0])).toContain("压缩摘要");
    expect(JSON.stringify(next_context)).toContain("第5轮");
    expect(service.get_snapshot().contextUsage?.tokens ?? Number.POSITIVE_INFINITY).toBeLessThan(
      Math.max(...usage_tokens),
    );
    expect(service.get_snapshot().entries).toHaveLength(12);
  });

  it("阈值压缩失败只记录 warning，已成功的最终回答不转成失败终态", async () => {
    const { service, log_error, log_warning } = await create_service();
    fake_agent_state.context_window = 65_001;
    fake_agent_state.summary_failures_remaining = 1;
    for (const round of [1, 2, 3, 4, 5]) {
      await service.send_message({
        parts: [{ kind: "text", text: `第${round.toString()}轮${"x".repeat(40_000)}` }],
      });
      await wait_for_idle(service);
    }

    expect(fake_agent_state.request_kinds).toContain("summary");
    expect(service.get_snapshot()).toMatchObject({
      state: "idle",
      entries: expect.arrayContaining([
        expect.objectContaining({
          kind: "assistant_message",
          parts: [{ kind: "text", text: "已完成" }],
        }),
      ]),
    });
    expect(log_warning).toHaveBeenCalledWith(
      "Agent 上下文压缩失败",
      expect.objectContaining({ source: "agent" }),
    );
    expect(log_error).not.toHaveBeenCalled();
  });

  it("同一事件循环的第二条消息异步拒绝，且不重复读取模型设置", async () => {
    const { service, read_setting_count } = await create_service();
    fake_agent_state.mode = "pending";

    const first = service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    const second = service.send_message({ parts: [{ kind: "text", text: "第二轮" }] });

    await expect(second).rejects.toThrow("runtime.busy");
    await expect(first).resolves.toMatchObject({ state: "running" });
    expect(read_setting_count()).toBe(1);
    expect(service.get_snapshot().entries).toEqual([
      expect.objectContaining({ parts: [{ kind: "text", text: "第一轮" }] }),
    ]);
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    service.stop();
  });

  it("运行中重复消息在读取新模型前被拒绝", async () => {
    const { service, read_setting_count } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });

    await expect(
      service.send_message({ parts: [{ kind: "text", text: "第二轮" }] }),
    ).rejects.toThrow("runtime.busy");
    expect(read_setting_count()).toBe(1);
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    service.stop();
  });

  it("read_skill 始终读取自动 skill，并仅在显式引用后读取 manual-only skill", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "read_skill";

    await service.send_message({ parts: [{ kind: "text", text: "普通对话" }] });
    await wait_for_idle(service);
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          id: "auto-root",
          status: "success",
          output: expect.stringContaining("执行术语审校。"),
        }),
        expect.objectContaining({
          kind: "tool_call",
          id: "auto-reference",
          status: "success",
          output: expect.stringContaining("完整正文。"),
        }),
        expect.objectContaining({
          kind: "tool_call",
          id: "manual-before-invocation",
          status: "error",
          output: expect.stringContaining("当前会话不可读取"),
        }),
      ]),
    );

    await service.send_message({ parts: [{ kind: "skill", name: "corpus-search" }] });
    await wait_for_idle(service);
    expect(service.get_snapshot().entries).toContainEqual(
      expect.objectContaining({
        kind: "tool_call",
        id: "manual-after-invocation",
        status: "success",
        output: expect.stringContaining("执行语料检索。"),
      }),
    );
  });

  it("资源未加载时拒绝启动模型回合", async () => {
    const { service } = await create_service(false);

    await expect(service.send_message({ parts: [{ kind: "text", text: "开始" }] })).rejects.toThrow(
      "runtime.internal_invariant",
    );
  });

  it("普通任务占用运行时期间拒绝 Agent 消息", async () => {
    const { service, runtime_gate } = await create_service();
    const lease = runtime_gate.begin_runtime("task");

    await expect(service.send_message({ parts: [{ kind: "text", text: "开始" }] })).rejects.toThrow(
      "runtime.busy",
    );
    runtime_gate.finish_runtime(lease);
  });

  /** 只替换资源、模型与领域协作者，生命周期、门禁和 AgentSession 仍走生产实现。 */
  async function create_service(load_resources = true): Promise<{
    service: AgentService;
    publish: ReturnType<typeof vi.fn>;
    read_items: ReturnType<typeof vi.fn<() => JsonRecord[]>>;
    log_error: ReturnType<typeof vi.fn>;
    log_warning: ReturnType<typeof vi.fn>;
    select_agent_model: (model_id: "active" | "next") => void;
    read_setting_count: () => number;
    runtime_gate: RuntimeOperationGate;
    change_project_facts: () => void;
    session_state: ProjectSessionState;
  }> {
    const session_state = new ProjectSessionState();
    await session_state.mark_loaded("test.lg");
    let revision = 3;
    let items_revision = 0;
    let proofreading_revision = 0;
    const read_items = vi.fn<() => JsonRecord[]>(() => []);
    const cache = {
      snapshot: () => ({
        projectPath: "test.lg",
        epoch: 1,
        freshness: "fresh" as const,
        sectionRevisions: {
          quality: revision,
          items: items_revision,
          proofreading: proofreading_revision,
        },
        itemCount: 0,
      }),
      items: { readItems: read_items, readItem: () => null },
    };
    let agent_model_id: "active" | "next" = "active";
    let setting_read_count = 0;
    const settings = {
      read_setting: () => {
        setting_read_count += 1;
        return {
          model_selection: { translation: "active", analysis: "active", agent: agent_model_id },
          models: [
            {
              id: "active",
              name: "Test",
              api_format: "OpenAI",
              api_url: "https://example.test/v1",
              api_key: "secret",
              model_id: "test-model",
              threshold: { input_token_limit: 4096, output_token_limit: 1024 },
            },
            {
              id: "next",
              name: "Next",
              api_format: "OpenAI",
              api_url: "https://example.test/v1",
              api_key: "next-secret",
              model_id: "next-model",
              threshold: { input_token_limit: 4096, output_token_limit: 1024 },
            },
          ],
        };
      },
    };
    const quality_rules = {
      query: () => ({
        projectPath: "test.lg",
        sectionRevisions: { quality: revision },
        qualityRule: { enabled: true, entries: [] },
      }),
      update_from_agent: async (
        _request: JsonRecord,
        _source: string,
      ): Promise<ProjectWriteResult> => {
        if (fake_agent_state.hold_tool_write) {
          await new Promise<void>((resolve) => {
            fake_agent_state.release_tool_write = () => {
              fake_agent_state.hold_tool_write = false;
              fake_agent_state.release_tool_write = null;
              resolve();
            };
          });
        }
        revision += 1;
        return { accepted: true, changes: [] };
      },
    };
    const proofreading = {
      query: {
        query_warnings: async () => ({
          projectPath: "test.lg",
          sectionRevisions: {
            quality: revision,
            items: items_revision,
            proofreading: proofreading_revision,
          },
          data: { total_item_count: 0, items: [], invalid_regex_message: null },
        }),
      },
      commands: {
        update_items_from_agent: async (
          _request: JsonRecord,
          _source: string,
        ): Promise<ProjectWriteResult> => {
          items_revision += 1;
          proofreading_revision += 1;
          return { accepted: true, changes: [] };
        },
      },
    };
    const publish = vi.fn((_topic: string, _payload: JsonRecord) => undefined);
    const log_error = vi.fn();
    const log_warning = vi.fn();
    const runtime_gate = new RuntimeOperationGate();
    const service = new AgentService({
      paths: {
        get_app_root: () => "E:/Project/LinguaGacha",
        get_agent_builtin_skill_dir: () => "E:/Project/LinguaGacha/resource/agent/skill",
        get_agent_user_skill_dir: () => "E:/Project/LinguaGacha/userdata/agent/skill",
        get_agent_system_prompt_path: () =>
          "E:/Project/LinguaGacha/resource/agent/system_prompt.md",
        get_agent_session_seed_path: () =>
          "E:/Project/LinguaGacha/resource/agent/session_seed.json",
      },
      settings,
      userAgent: "LinguaGacha/Test",
      sessionState: session_state,
      cache,
      qualityRules: quality_rules,
      proofreading,
      runtimeGate: runtime_gate,
      computeWorker: new ComputeWorkerClient({ execution: { kind: "in_process" } }),
      logManager: { error: log_error, warning: log_warning },
      publish,
    });
    if (load_resources) await service.load_resources();
    services.push(service);
    return {
      service,
      publish,
      read_items,
      log_error,
      log_warning,
      select_agent_model: (model_id) => {
        agent_model_id = model_id;
      },
      read_setting_count: () => setting_read_count,
      runtime_gate,
      change_project_facts: () => {
        revision += 1;
        items_revision += 1;
        proofreading_revision += 1;
      },
      session_state,
    };
  }
});

/** 等待公开会话终态，不依赖 SDK 内部 idle 时序。 */
async function wait_for_idle(service: AgentService): Promise<void> {
  await vi.waitFor(() => expect(service.get_snapshot().state).toBe("idle"));
}

/** 事件数量本身是 reset/生命周期只发布一次 seed 的公开契约。 */
function count_published_events(publish: ReturnType<typeof vi.fn>, type: string): number {
  return publish.mock.calls.filter(([, event]) => event["type"] === type).length;
}

/** 集中断言每轮都必须保持的系统指令边界，避免多个用例复制长清单。 */
function expect_agent_system_prompt(prompt: string | undefined): void {
  expect(prompt).toContain("基础系统指令。");
  expect(prompt).toContain("<available_skills>");
  expect(prompt).toContain("<name>glossary-audit</name>");
  expect(prompt).toContain("<description>审校术语</description>");
  expect(prompt).not.toContain("Review glossary");
  expect(prompt).toContain("<location>E:/skills/glossary-audit/SKILL.md</location>");
  expect(prompt).not.toContain("<name>corpus-search</name>");
  expect(prompt).not.toContain("执行术语审校。");
  expect(prompt).not.toContain("完整正文。");
  expect(prompt).not.toContain("You are an expert coding assistant operating inside pi");
  expect(prompt).not.toContain("LinguaGacha Agent 协作指南");
  expect(prompt?.match(/Current working directory:/gu)).toHaveLength(1);
  expect(prompt?.endsWith("Current working directory: E:/Project/LinguaGacha")).toBe(true);
}
