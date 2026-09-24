import { AgentTokenSpeed } from "./agent-token-speed";
import { uploaded_file } from "../../test/agent-upload-fixture";
import { workspace_execution } from "../../test/agent-workspace-fixture";
import { Model as AppModel } from "../../domain/model";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import { resolve_model_for_usage } from "../model/model-config-resolver";
import { BatchTranslationCompletionError } from "../batch-translation/batch-translation-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProvider,
  getCurrentSystemPrompt,
  getCurrentTools,
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type TranscriptContext,
  type FauxResponseStep,
  type Model,
  type ProviderStreams,
  type StreamOptions,
  type TextContent,
  type ImageContent,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AppLanguage } from "../../domain/app-language";
import type { JsonRecord } from "../../domain/json";
import type { AgentCommandAck, AgentSessionEvent } from "../../shared/agent";
import type { AgentWebSearchPort } from "./model-tools/web-search";
import * as workspace_tools from "./model-tools/workspace";
import { ProjectSessionState } from "../project/project-session-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { read_builtin_pi_models } from "../llm/pi-model-catalog";

/** 集中保存模型定义与公开快照的共同 skill 身份，避免协议断言复制语言矩阵。 */
const skill_test_fixture = vi.hoisted(() => {
  const app_root = "E:/linguagacha-agent-service-test";
  const skill_root = `${app_root}/builtin-skills`;
  const corpus_search_snapshot = {
    name: "corpus-search",
    displayDescriptions: {
      "zh-CN": "检索语料",
      "en-US": "Search corpus",
      "de-DE": "Korpus durchsuchen",
    },
  };
  const glossary_audit_snapshot = {
    name: "glossary-audit",
    displayDescriptions: {
      "zh-CN": "审校术语",
      "en-US": "Review glossary",
      "de-DE": "Glossar prüfen",
    },
  };
  const glossary_audit_content = `${glossary_audit_snapshot.name}:fixture`;
  const snapshots = [glossary_audit_snapshot, corpus_search_snapshot];
  const skills = [
    {
      ...glossary_audit_snapshot,
      visible: true,
      description: "审校术语",
      content: glossary_audit_content,
      filePath: `${skill_root}/glossary-audit/SKILL.md`,
      disableModelInvocation: false,
    },
    {
      ...corpus_search_snapshot,
      visible: true,
      order: Number.MAX_SAFE_INTEGER,
      description: "检索语料",
      content: `${corpus_search_snapshot.name}:fixture`,
      filePath: `${skill_root}/corpus-search/SKILL.md`,
      disableModelInvocation: true,
    },
    {
      name: "internal-guidance",
      visible: false,
      order: 0,
      displayDescriptions: {
        "zh-CN": "内部指导",
        "en-US": "Internal guidance",
        "de-DE": "Interne Anleitung",
      },
      description: "内部指导",
      content: "internal-guidance:fixture",
      filePath: `${skill_root}/internal-guidance/SKILL.md`,
      disableModelInvocation: false,
    },
  ];
  return {
    app_root,
    fixture_contents: { glossary_audit: glossary_audit_content },
    skill_root,
    snapshots,
    loader: vi.fn(() => skills),
  };
});
const agent_resource_fixture = vi.hoisted(() => {
  const system_prompt = "system-prompt-fixture";
  const session_seed = [
    { role: "user", content: "seed-user-1" },
    { role: "assistant", content: "seed-assistant-1" },
    { role: "user", content: "seed-user-2" },
    { role: "assistant", content: "seed-assistant-2" },
  ] as const;
  return {
    system_prompt,
    session_seed,
    system_prompt_loader: vi.fn(() => system_prompt),
    session_seed_loader: vi.fn(() => session_seed),
  };
});
const agent_model_registrar = vi.hoisted(() => vi.fn());
// 该窗口刚好容纳固定保留量与输出预留，用于稳定触发自动压缩边界。
const TEST_COMPACTION_CONTEXT_WINDOW = 65_001;
const FAKE_WORKSPACE_SCRIPT = "console.log(JSON.stringify({ items: [] }));";
const FAKE_TODO_WRITE_SCRIPT = 'ws.todo.write(["基础扫描"]); console.log(null);';
const FAKE_TODO_READ_SCRIPT = "console.log(JSON.stringify({ todos: ws.todo.read() }));";
const FAKE_TODO_CLEAR_SCRIPT = "ws.todo.write([]); console.log(null);";

const fake_agent_state = vi.hoisted(() => ({
  mode: "success" as
    | "success"
    | "question"
    | "write"
    | "error"
    | "tools_error"
    | "pending"
    | "retry"
    | "streaming"
    | "thinking"
    | "tool_only"
    | "todo_write"
    | "todo_read"
    | "todo_clear"
    | "invalid_tool"
    | "tool_compaction"
    | "overflow"
    | "length"
    | "tools",
  batch_mode: false,
  batch_retries: 0,
  abort_count: 0,
  system_prompts: [] as string[],
  prompts: [] as string[],
  model_ids: [] as string[],
  request_model_limits: [] as Array<{ contextWindow: number; maxTokens: number }>,
  tool_names: [] as string[][],
  release_pending: null as (() => void) | null,
  hold_idle: false,
  hold_tool_execution: false,
  release_tool_execution: null as (() => void) | null,
  context_window: 288_000,
  max_tokens: 32_000,
  model_call_count: 0,
  retry_failures_remaining: 0,
  summary_failures_remaining: 0,
  hold_next_summary: false,
  release_summary: null as (() => void) | null,
  request_kinds: [] as Array<"model" | "summary">,
  model_contexts: [] as TranscriptContext["messages"][],
  summary_contexts: [] as TranscriptContext["messages"][],
  auth_configured: true,
  hold_auth: false,
  auth_wait: null as Promise<void> | null,
  release_auth: null as (() => void) | null,
  stream_token_size: 10_000,
  stream_tokens_per_second: undefined as number | undefined,
}));

vi.mock("./agent-skills", async (import_original) => ({
  ...(await import_original<typeof import("./agent-skills")>()),
  load_agent_skills: skill_test_fixture.loader,
}));
vi.mock("./agent-session-seed", async (import_original) => ({
  ...(await import_original<typeof import("./agent-session-seed")>()),
  load_agent_session_seed: agent_resource_fixture.session_seed_loader,
}));
vi.mock("./agent-system-prompt", () => ({
  load_agent_system_prompt: agent_resource_fixture.system_prompt_loader,
}));
vi.mock("./agent-model", () => ({ register_agent_model: agent_model_registrar }));

import { AgentService } from "./agent-service";
import type { AgentWorkspacePort } from "./workspace/service";

/** 测试只替换远程流边界，Agent 的事件、工具执行、abort 与收尾均使用真实实现。 */
const fake_provider_streams: ProviderStreams = {
  stream: (model, context, options) => create_fake_agent_stream(model, context, options),
  streamSimple: (model, context, options) => create_fake_agent_stream(model, context, options),
};

/** 记录每次模型或摘要请求，并按当前测试剧本创建可控远程响应。 */
function create_fake_agent_stream(
  model: Model<any>,
  context: TranscriptContext,
  options: StreamOptions | undefined,
) {
  const is_summary =
    getCurrentSystemPrompt(context.messages)?.includes("context summarization assistant") === true;
  fake_agent_state.request_kinds.push(is_summary ? "summary" : "model");
  if (!is_summary) {
    fake_agent_state.model_call_count += 1;
    fake_agent_state.model_contexts.push(structuredClone(context.messages));
  } else {
    fake_agent_state.summary_contexts.push(structuredClone(context.messages));
  }
  fake_agent_state.system_prompts.push(getCurrentSystemPrompt(context.messages) ?? "");
  fake_agent_state.prompts.push(read_last_user_text(context));
  fake_agent_state.model_ids.push(model.id);
  fake_agent_state.request_model_limits.push({
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  });
  fake_agent_state.tool_names.push(
    getCurrentTools(context.messages).map((tool) => tool.name) ?? [],
  );
  const hold_summary = is_summary && fake_agent_state.hold_next_summary;
  if (hold_summary) fake_agent_state.hold_next_summary = false;
  const faux = createFauxCore({
    api: model.api,
    provider: model.provider,
    tokenSize: {
      min: fake_agent_state.stream_token_size,
      max: fake_agent_state.stream_token_size,
    },
    tokensPerSecond: fake_agent_state.stream_tokens_per_second,
  });
  const response = hold_summary
    ? async (_context: TranscriptContext, stream_options: StreamOptions | undefined) =>
        await wait_for_summary_release(stream_options?.signal)
    : is_summary
      ? create_fake_summary_response()
      : create_fake_response(context);
  faux.setResponses([response]);
  return faux.streamSimple(model, context, options);
}

/** 根据测试配置选择模型身份，远程行为统一交给同一个可控流边界。 */
function register_fake_agent_model(model_runtime: ModelRuntime, config: JsonRecord) {
  const selection = config["model_selection"];
  const selected =
    typeof selection === "object" && selection !== null && !Array.isArray(selection)
      ? Reflect.get(selection, "agent")
      : undefined;
  const model_id = selected === "next" ? "next-model" : "test-model";
  const limits = {
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
    input: ["text" as const, "image" as const],
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
  return {
    model,
    thinkingLevel: "off" as const,
    model_config: AppModel.from_json(
      {
        ...resolve_model_for_usage(config, "agent"),
        thinking: { level: "OFF" },
      },
      String(selected),
    ),
  };
}

/** 只描述模型响应，不复制 Agent 的事件协议、工具执行或生命周期。 */
function create_fake_response(context: TranscriptContext): FauxResponseStep {
  if (fake_agent_state.mode === "overflow" || fake_agent_state.mode === "length") {
    const stop_reason = fake_agent_state.mode === "overflow" ? "error" : "length";
    fake_agent_state.mode = "success";
    return fauxAssistantMessage("废弃的恢复尝试", {
      stopReason: stop_reason,
      ...(stop_reason === "error" ? { errorMessage: "context_length_exceeded" } : {}),
    });
  }
  if (fake_agent_state.mode === "pending") {
    return async (_context, options) => await wait_for_pending_release(options?.signal);
  }
  const after_tool_call = context.messages.at(-1)?.role === "toolResult";
  if (fake_agent_state.batch_mode) {
    const retry = after_tool_call && fake_agent_state.batch_retries-- > 0;
    return after_tool_call && !retry
      ? fauxAssistantMessage("翻译完成")
      : fauxAssistantMessage(
          fauxToolCall(
            "run_batch_item_translation",
            { scope: { kind: "all" }, include_errors: false },
            { id: "batch-translation" },
          ),
          { stopReason: "toolUse" },
        );
  }
  if (fake_agent_state.mode === "tool_compaction") {
    if (after_tool_call) {
      return fauxAssistantMessage(
        JSON.stringify(context.messages).includes("压缩摘要") ? "压缩后完成" : "未压缩继续",
      );
    }
    return fauxAssistantMessage(
      fauxToolCall(
        "workspace_run",
        { script: FAKE_WORKSPACE_SCRIPT },
        { id: "tool-compaction-query" },
      ),
      { stopReason: "toolUse" },
    );
  }
  if (after_tool_call) {
    if (fake_agent_state.mode === "tools") return fauxAssistantMessage("查询完成");
    if (fake_agent_state.mode === "tools_error") {
      return fauxAssistantMessage("部分结果", {
        stopReason: "error",
        errorMessage: "request failed",
      });
    }
    return fauxAssistantMessage([]);
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
      fauxText(" \n "),
      fauxText("已完成"),
    ]);
  }
  if (fake_agent_state.mode === "streaming") {
    return fauxAssistantMessage("abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx");
  }
  if (fake_agent_state.mode === "write") {
    return fauxAssistantMessage(fauxToolCall("workspace_apply", {}, { id: "write-1" }), {
      stopReason: "toolUse",
    });
  }
  if (fake_agent_state.mode === "question") {
    return fauxAssistantMessage(
      fauxToolCall(
        "ask_user",
        {
          prompt: "选择处理范围",
          description: "选择接下来处理的内容",
          options: [
            { id: "safe", label: "安全范围" },
            { id: "complete", label: "完整范围" },
          ],
        },
        { id: "question-1" },
      ),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "tool_only") {
    return fauxAssistantMessage(
      fauxToolCall("workspace_run", { script: FAKE_WORKSPACE_SCRIPT }, { id: "tool-only" }),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "todo_write") {
    return fauxAssistantMessage(
      fauxToolCall("workspace_run", { script: FAKE_TODO_WRITE_SCRIPT }, { id: "todo-write" }),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "todo_read") {
    return fauxAssistantMessage(
      fauxToolCall("workspace_run", { script: FAKE_TODO_READ_SCRIPT }, { id: "todo-read" }),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "todo_clear") {
    return fauxAssistantMessage(
      fauxToolCall("workspace_run", { script: FAKE_TODO_CLEAR_SCRIPT }, { id: "todo-clear" }),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "invalid_tool") {
    return fauxAssistantMessage(
      fauxToolCall("workspace_run", { script: "" }, { id: "schema-invalid" }),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "tools" || fake_agent_state.mode === "tools_error") {
    return fauxAssistantMessage(
      [
        fauxText("准备查询"),
        fauxToolCall("workspace_run", { script: FAKE_WORKSPACE_SCRIPT }, { id: "tool-1" }),
      ],
      { stopReason: "toolUse" },
    );
  }
  return fauxAssistantMessage("已完成");
}

/** 从模型实际收到的上下文读取最近 user 文本，兼容字符串与 text block。 */
function read_last_user_text(context: TranscriptContext): string {
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

/** 摘要与普通模型响应独立配置，失败次数由实际摘要请求消费。 */
function create_fake_summary_response(): AssistantMessage {
  if (fake_agent_state.summary_failures_remaining > 0) {
    fake_agent_state.summary_failures_remaining -= 1;
    return fauxAssistantMessage([], { stopReason: "error", errorMessage: "摘要生成失败" });
  }
  return fauxAssistantMessage("压缩摘要");
}

/** 摘要挂起后仍按释放时的剧本结算，允许在恢复期间提交队列输入。 */
function wait_for_summary_release(signal: AbortSignal | undefined): Promise<AssistantMessage> {
  return new Promise((resolve) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handle_abort);
      if (fake_agent_state.release_summary === release) {
        fake_agent_state.release_summary = null;
      }
      resolve(create_fake_summary_response());
    };
    const handle_abort = () => {
      if (!fake_agent_state.hold_idle) release();
    };
    fake_agent_state.release_summary = release;
    if (signal?.aborted === true) handle_abort();
    else signal?.addEventListener("abort", handle_abort, { once: true });
  });
}

describe("AgentService", () => {
  const services: AgentService[] = [];

  beforeEach(() => {
    fake_agent_state.batch_mode = false;
    fake_agent_state.batch_retries = 0;
    fake_agent_state.mode = "success";
    fake_agent_state.abort_count = 0;
    fake_agent_state.system_prompts = [];
    fake_agent_state.prompts = [];
    fake_agent_state.model_ids = [];
    fake_agent_state.request_model_limits = [];
    fake_agent_state.tool_names = [];
    fake_agent_state.release_pending = null;
    fake_agent_state.hold_idle = false;
    fake_agent_state.hold_tool_execution = false;
    fake_agent_state.release_tool_execution = null;
    fake_agent_state.context_window = 288_000;
    fake_agent_state.max_tokens = 32_000;
    fake_agent_state.model_call_count = 0;
    fake_agent_state.retry_failures_remaining = 0;
    fake_agent_state.summary_failures_remaining = 0;
    fake_agent_state.hold_next_summary = false;
    fake_agent_state.release_summary = null;
    fake_agent_state.request_kinds = [];
    fake_agent_state.model_contexts = [];
    fake_agent_state.summary_contexts = [];
    fake_agent_state.auth_configured = true;
    fake_agent_state.hold_auth = false;
    fake_agent_state.auth_wait = null;
    fake_agent_state.release_auth = null;
    fake_agent_state.stream_token_size = 10_000;
    fake_agent_state.stream_tokens_per_second = undefined;
    agent_model_registrar.mockReset();
    agent_model_registrar.mockImplementation(register_fake_agent_model);
    skill_test_fixture.loader.mockClear();
    agent_resource_fixture.system_prompt_loader.mockClear();
    agent_resource_fixture.session_seed_loader.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fake_agent_state.hold_idle = false;
    fake_agent_state.release_auth?.();
    fake_agent_state.release_tool_execution?.();
    fake_agent_state.release_pending?.();
    fake_agent_state.release_summary?.();
    await Promise.all(services.splice(0).map(async (service) => await service.dispose()));
  });

  it("快照沿用技能加载结果的展示顺序，并在变更状态前拒绝非法消息", async () => {
    const fixture = await create_service();

    expect(fixture.service.get_snapshot().skills).toEqual(skill_test_fixture.snapshots);
    await expect(fixture.service.send_message({ message: "旧协议" })).rejects.toThrow(
      "request.validation_failed",
    );
    await expect(fixture.service.send_message({ text: 1, attachments: [] })).rejects.toThrow(
      "request.validation_failed",
    );
    await expect(fixture.service.send_message({ text: "正文" })).rejects.toThrow(
      "request.validation_failed",
    );
    await expect(fixture.service.send_message({ text: "正文", attachments: [1] })).rejects.toThrow(
      "request.validation_failed",
    );
    await expect(fixture.service.send_message({ text: " \n ", attachments: [] })).rejects.toThrow(
      "request.validation_failed",
    );
    expect(fixture.service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
  });

  it("命令只回执最后事件 revision，且公开事件 revision 严格递增", async () => {
    const { service, publish } = await create_service();

    const acknowledgement = await service.send_message({ text: "开始", attachments: [] });
    const events = publish.mock.calls.map(([, payload]) => payload);
    const revisions = events.map((event) => event["revision"]);

    expect(revisions).toEqual(revisions.map((_, index) => index + 1));
    expect(acknowledgement).toEqual({ revision: revisions.at(-1) });
    expect(acknowledgement).not.toHaveProperty("entries");
    expect(service.get_snapshot().revision).toBe(revisions.at(-1));
  });

  it("写入审批模式通过快照与事件同步，模型请求保持稳定", async () => {
    const fixture = await create_service();

    expect(fixture.service.get_snapshot()).toMatchObject({ approvalMode: "manual" });
    expect(fixture.service.set_approval_mode({ approvalMode: "auto" })).toEqual({ revision: 1 });
    expect(fixture.service.get_snapshot()).toMatchObject({ approvalMode: "auto" });
    expect(fixture.publish).toHaveBeenCalledWith(
      "agent.session_event",
      expect.objectContaining({ type: "approval_mode", approvalMode: "auto", revision: 1 }),
    );

    await fixture.service.send_message({ text: "执行任务", attachments: [] });
    await wait_for_idle(fixture.service);
    const stable_system_prompt = fake_agent_state.system_prompts[0];

    await fixture.service.reset();
    await fixture.service.send_message({ text: "手动任务", attachments: [] });
    await wait_for_idle(fixture.service);
    expect(fake_agent_state.system_prompts.at(-1)).toBe(stable_system_prompt);

    expect(fixture.service.get_snapshot()).toMatchObject({ approvalMode: "manual" });
    expect(() => fixture.service.set_approval_mode({ approvalMode: "unknown" })).toThrow(
      "request.validation_failed",
    );
  });

  it.each([
    ["allow_once", "manual"],
    ["allow_session", "auto"],
  ] as const)(
    "写入决定 %s 受理后清除浮层并提交，审批模式为 %s",
    async (decision, approval_mode) => {
      const fixture = await create_service();
      fake_agent_state.mode = "write";
      fake_agent_state.hold_tool_execution = true;

      await fixture.service.send_message({ text: "写入", attachments: [] });
      await vi.waitFor(() =>
        expect(fixture.service.get_snapshot().pendingDecision).toMatchObject({
          kind: "write_approval",
          summary: {
            pages: 0,
            items: 1,
            glossary: 0,
            textPreserve: 0,
            preReplacement: 0,
            postReplacement: 0,
            prompts: 0,
          },
        }),
      );
      const pending = fixture.service.get_snapshot().pendingDecision;
      if (pending?.kind !== "write_approval") throw new Error("缺少待审批写入");
      expect(fixture.service.get_snapshot().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "tool_call",
            toolName: "workspace_apply",
            status: "running",
          }),
        ]),
      );

      const approval_ack = fixture.service.resolve_write_approval({
        id: pending.id,
        decision,
      });
      await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(approval_ack).toEqual({ revision: expect.any(Number) });
        expect(fixture.service.get_snapshot().pendingDecision).toBeNull();
      } finally {
        fake_agent_state.release_tool_execution?.();
      }
      await wait_for_idle(fixture.service);
      expect(fixture.service.get_snapshot().pendingDecision).toBeNull();
      expect(fixture.service.get_snapshot().approvalMode).toBe(approval_mode);
      expect(fixture.service.get_snapshot().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "tool_call",
            toolName: "workspace_apply",
            status: "success",
          }),
        ]),
      );
    },
  );

  it("审批等待与提交期间的新模式优先于旧批次成功回写", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "write";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "写入", attachments: [] });
    await vi.waitFor(() => expect(service.get_snapshot().pendingDecision).not.toBeNull());
    const pending = service.get_snapshot().pendingDecision!;
    service.set_approval_mode({ approvalMode: "auto" });
    expect(service.get_snapshot().pendingDecision?.id).toBe(pending.id);
    service.resolve_write_approval({ id: pending.id, decision: "allow_session" });
    await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
    service.set_approval_mode({ approvalMode: "manual" });
    fake_agent_state.release_tool_execution?.();
    await wait_for_idle(service);
    expect(service.get_snapshot().approvalMode).toBe("manual");
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          toolName: "workspace_apply",
          status: "success",
        }),
      ]),
    );
  });

  it("拒绝手动写入后以工具失败结束", async () => {
    const fixture = await create_service();
    fake_agent_state.mode = "write";

    await fixture.service.send_message({ text: "拒绝写入", attachments: [] });
    await vi.waitFor(() => expect(fixture.service.get_snapshot().pendingDecision).not.toBeNull());
    const pending = fixture.service.get_snapshot().pendingDecision;
    if (pending?.kind !== "write_approval") throw new Error("缺少待审批写入");

    fixture.service.resolve_write_approval({ id: pending.id, decision: "reject" });
    await wait_for_idle(fixture.service);
    expect(fixture.service.get_snapshot().pendingDecision).toBeNull();
    expect(fixture.service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          toolName: "workspace_apply",
          status: "error",
          output: [expect.stringContaining('"action":"await_user"')],
        }),
      ]),
    );
  });

  it("reset 隔离仍在等待的写入决定", async () => {
    const fixture = await create_service();
    fake_agent_state.mode = "write";
    fake_agent_state.hold_tool_execution = true;

    await fixture.service.send_message({ text: "写入后重置", attachments: [] });
    await vi.waitFor(() =>
      expect(fixture.service.get_snapshot().pendingDecision).toMatchObject({
        kind: "write_approval",
      }),
    );
    await expect(fixture.service.reset()).resolves.toEqual({ revision: expect.any(Number) });
    expect(fixture.service.get_snapshot()).toMatchObject({
      state: "idle",
      pendingDecision: null,
      entries: [],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(fake_agent_state.release_tool_execution).toBeNull();
    expect(fixture.service.get_snapshot()).toMatchObject({
      state: "idle",
      pendingDecision: null,
      entries: [],
    });
  });

  it("ask_user 以结构化答案恢复同一工具轮次", async () => {
    const fixture = await create_service();
    fake_agent_state.mode = "question";

    await fixture.service.send_message({ text: "开始", attachments: [] });
    await vi.waitFor(() =>
      expect(fixture.service.get_snapshot().pendingDecision).toMatchObject({
        kind: "question",
        question: { prompt: "选择处理范围" },
      }),
    );
    const pending = fixture.service.get_snapshot().pendingDecision;
    if (pending?.kind !== "question") throw new Error("缺少待回答问题");
    expect(fixture.service.get_snapshot().inputQueue.canSendNow).toBe(false);

    fixture.service.resolve_question({
      id: pending.id,
      response: { kind: "option", optionId: "complete" },
    });
    expect(fixture.service.get_snapshot().pendingDecision).toBeNull();
    await wait_for_idle(fixture.service);

    expect(read_tool_output(fixture.service, "question-1")).toEqual({
      outcome: "selected",
      optionId: "complete",
    });
    expect(
      fixture.service.get_snapshot().entries.filter((entry) => entry.kind === "user_message"),
    ).toHaveLength(1);
  });

  it("把纯图片作为 WebP 传给模型并原样写入公开时间线", async () => {
    const fixture = await create_service();

    await fixture.service.send_message({
      text: "",
      attachments: [uploaded_file("webp-a"), uploaded_file("webp-b")],
    });
    await wait_for_idle(fixture.service);

    expect(fixture.service.get_snapshot().entries[0]).toMatchObject({
      kind: "user_message",
      text: "",
      attachments: [uploaded_file("webp-a"), uploaded_file("webp-b")],
      status: "success",
    });
    const last_user = fake_agent_state.model_contexts
      .at(-1)
      ?.findLast((message) => message.role === "user");
    expect(last_user).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("uploads/webp-a.png") },
        { type: "image", data: Buffer.from("webp-a").toString("base64"), mimeType: "image/webp" },
        { type: "image", data: Buffer.from("webp-b").toString("base64"), mimeType: "image/webp" },
      ],
    });
  });

  it("附件准备与消息受理都使用后端结果，图片准备不能跨 reset 提交", async () => {
    const images = {
      clear: vi.fn(),
      prepare: vi.fn(async (_data: unknown) => ({
        data: "prepared",
        mimeType: "image/webp" as const,
        width: 1,
        height: 1,
        originalWidth: 1,
        originalHeight: 1,
      })),
    };
    const { service } = await create_service(true, undefined, undefined, undefined, images);
    await service.send_message({
      text: "image",
      attachments: [uploaded_file("raw")],
    });
    await wait_for_idle(service);
    expect(service.get_snapshot().entries[0]).toMatchObject({
      attachments: [uploaded_file("raw")],
    });
    expect(
      fake_agent_state.model_contexts.at(-1)?.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: expect.arrayContaining([
        { type: "image", data: "prepared", mimeType: "image/webp" },
      ]),
    });
    let release!: (image: Awaited<ReturnType<typeof images.prepare>>) => void;
    images.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.send_message({
      text: "late",
      attachments: [uploaded_file("raw")],
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "runtime.cancelled" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const reset = service.reset();
    release({
      data: "late",
      mimeType: "image/webp",
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
    });
    await rejected;
    await reset;
    expect(images.clear).toHaveBeenCalled();
    expect(service.get_snapshot().entries).toEqual([]);
  });

  it("把含空评论的回复批注写入公开时间线，并只向模型投影选文与评论", async () => {
    const fixture = await create_service();

    await fixture.service.send_message({
      text: "请按批注修改",
      attachments: [
        {
          kind: "response_annotation",
          selectedText: "旧回复片段",
          comment: "这里需要更准确",
        },
        { kind: "response_annotation", selectedText: "另一段旧回复", comment: "" },
      ],
    });
    await wait_for_idle(fixture.service);

    expect(fixture.service.get_snapshot().entries[0]).toMatchObject({
      kind: "user_message",
      text: "请按批注修改",
      attachments: [
        {
          kind: "response_annotation",
          selectedText: "旧回复片段",
          comment: "这里需要更准确",
        },
        { kind: "response_annotation", selectedText: "另一段旧回复", comment: "" },
      ],
    });
    const prompt = fake_agent_state.prompts.at(-1) ?? "";
    expect(prompt).toContain("旧回复片段");
    expect(prompt).toContain("这里需要更准确");
    expect(prompt).toContain("另一段旧回复");
    expect(prompt).not.toContain("response_annotation");
    expect(prompt.endsWith("请按批注修改")).toBe(true);
  });

  it("skill 快照复制 UI 描述，不向调用方暴露内部资源引用", async () => {
    const fixture = await create_service();
    const expected_skills = structuredClone(skill_test_fixture.snapshots);
    const snapshot = fixture.service.get_snapshot();

    snapshot.skills[0]!.displayDescriptions["en-US"] = "污染外部快照";

    expect(fixture.service.get_snapshot().skills).toEqual(expected_skills);
  });

  it("当前会话冻结 catalog，reset 后才刷新 System Prompt、mention 与 marker", async () => {
    const fixture = await create_service();
    const current_skills = skill_test_fixture.loader.mock.results.at(-1)?.value ?? [];
    skill_test_fixture.loader.mockReturnValueOnce([
      ...current_skills,
      {
        name: "new-skill",
        visible: true,
        order: 50,
        displayDescriptions: {
          "zh-CN": "新技能",
          "en-US": "New skill",
          "de-DE": "Neue Fähigkeit",
        },
        description: "会话中新增的技能",
        content: "new-skill:fixture",
        filePath: `${skill_test_fixture.skill_root}/new-skill/SKILL.md`,
        disableModelInvocation: false,
      },
    ]);

    expect(fixture.service.get_snapshot().skills.map(({ name }) => name)).not.toContain(
      "new-skill",
    );
    expect(skill_test_fixture.loader).toHaveBeenCalledTimes(1);

    await fixture.service.reset();
    expect(fixture.service.get_snapshot().skills.map(({ name }) => name)).toContain("new-skill");
    expect(skill_test_fixture.loader).toHaveBeenCalledTimes(2);

    await fixture.service.send_message({ text: '@skill("new-skill") 开始', attachments: [] });
    await wait_for_idle(fixture.service);
    expect(fake_agent_state.system_prompts.at(-1)).toContain("<name>new-skill</name>");
    expect(fake_agent_state.system_prompts.at(-1)).not.toContain("<location>");
    expect(fake_agent_state.prompts.at(-1)).toBe('@skill("new-skill") 开始');
  });

  it("种子消息按顺序进入模型历史且不公开到时间线", async () => {
    const fixture = await create_service();

    await fixture.service.send_message({ text: "正文", attachments: [] });
    await wait_for_idle(fixture.service);

    const context = (fake_agent_state.model_contexts[0] ?? []).filter(
      (message) => message.role !== "system",
    );
    expect(context.slice(0, agent_resource_fixture.session_seed.length)).toMatchObject(
      agent_resource_fixture.session_seed.map((message) =>
        message.role === "assistant"
          ? { role: "assistant", content: [{ type: "text", text: message.content }] }
          : message,
      ),
    );
    expect(context[agent_resource_fixture.session_seed.length]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "正文" }],
    });
    const entries = fixture.service.get_snapshot().entries;
    expect(entries[0]).toMatchObject({
      kind: "user_message",
      text: "正文",
    });
    const public_content = JSON.stringify([entries, fixture.publish.mock.calls]);
    for (const message of agent_resource_fixture.session_seed) {
      expect(public_content).not.toContain(message.content);
    }
  });

  it("各类技能引用按用户正文完整传给模型和公开时间线", async () => {
    const fixture = await create_service();
    const text = [
      '@skill("corpus-search") @skill("glossary-audit") @skill("internal-guidance")',
      '@skill("glossary-audit") @skill("unknown") @unknown(reference) @glossary-audit',
      String.raw`\@skill(\"glossary-audit\") 只讨论语法`,
    ].join("\n");

    await fixture.service.send_message({ text, attachments: [] });
    await wait_for_idle(fixture.service);

    expect(fake_agent_state.prompts.at(-1)).toBe(text);
    expect(fixture.service.get_snapshot().entries[0]).toMatchObject({ text });
  });

  it("模型回合从 running 回到 idle，并由条目保存成功终态", async () => {
    const { service, publish } = await create_service();

    await service.send_message({
      text: "开始",
      attachments: [uploaded_file("webp-image")],
    });
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
          text: "开始",
          attachments: [uploaded_file("webp-image")],
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

  it("显示精度相同的速度不重复发布，但每个增量仍参与统计", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 10;
    const measure = AgentTokenSpeed.prototype.measure;
    let measurements = 0;
    const record_spy = vi.spyOn(AgentTokenSpeed.prototype, "record");
    const spy = vi.spyOn(AgentTokenSpeed.prototype, "measure").mockImplementation(function (
      this: AgentTokenSpeed,
      now,
    ) {
      measure.call(this, now);
      return 99.991 + (++measurements % 2) * 0.001;
    });
    try {
      await service.send_message({ text: "开始", attachments: [] });
      await vi.runAllTimersAsync();
      await wait_for_idle(service);
      const speeds = publish.mock.calls.flatMap(([, payload]) => {
        const event = payload as AgentSessionEvent;
        return event.type === "token_speed" ? [event.tokenSpeed?.tokensPerSecond ?? null] : [];
      });
      expect(measurements).toBeGreaterThan(1);
      expect(measurements).toBeLessThan(record_spy.mock.calls.length);
      expect(speeds).toEqual([99.99, null]);
    } finally {
      spy.mockRestore();
      record_spy.mockRestore();
    }
  });

  it("高频助手增量合并发布，终态保留完整正文和条目身份", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 40;
    const received_deltas = vi.spyOn(AgentTokenSpeed.prototype, "record"); // 此场景只含正文，计数入口接收每个原始增量。

    await service.send_message({ text: "开始", attachments: [] });
    await vi.runAllTimersAsync();
    await wait_for_idle(service);

    const events = publish.mock.calls.map(([, payload]) => payload as AgentSessionEvent);
    const assistant_entries = events.flatMap((event) =>
      event.type === "entry_upsert" && event.entry.kind === "assistant_message"
        ? [event.entry]
        : [],
    );
    const running_entries = assistant_entries.filter((entry) => entry.status === "running");
    const final_text = "abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx";
    expect(running_entries.length).toBeGreaterThan(0);
    expect(running_entries.length).toBeLessThan(received_deltas.mock.calls.length);
    expect(
      running_entries.every(
        ({ parts }) =>
          parts.length === 1 && parts[0]?.kind === "text" && final_text.startsWith(parts[0].text),
      ),
    ).toBe(true);
    expect(
      running_entries
        .slice(1)
        .every(
          (entry, index) =>
            entry.parts[0]!.text.length >= running_entries[index]!.parts[0]!.text.length,
        ),
    ).toBe(true);
    expect(new Set(assistant_entries.map((entry) => entry.id)).size).toBe(1);
    expect(assistant_entries.at(-1)).toMatchObject({
      parts: [{ kind: "text", text: final_text }],
      status: "success",
    });
    const final_assistant_index = events.findLastIndex(
      (event) =>
        event.type === "entry_upsert" &&
        event.entry.kind === "assistant_message" &&
        event.entry.status === "success",
    );
    const final_user_index = events.findLastIndex(
      (event) =>
        event.type === "entry_upsert" &&
        event.entry.kind === "user_message" &&
        event.entry.status === "success",
    );
    expect(final_user_index).toBeGreaterThan(final_assistant_index);
    expect(service.get_snapshot().entries.at(-1)).toEqual(assistant_entries.at(-1));
  });

  it("从真实 Agent 消息历史发布上下文用量，并在重置时清空", async () => {
    const { service, publish } = await create_service();
    expect(service.get_snapshot().context).toEqual({
      tokens: null,
      compactable: false,
      limits: null,
    });

    await service.send_message({ text: "x".repeat(400), attachments: [] });
    await wait_for_idle(service);

    const context_events = publish.mock.calls
      .map(([, event]) => event)
      .filter((event) => event["type"] === "context");
    expect(context_events[0]).toEqual({
      type: "context",
      revision: expect.any(Number),
      context: {
        tokens: expect.any(Number),
        compactable: false,
        limits: { context_window: expect.any(Number), max_output_tokens: expect.any(Number) },
      },
    });
    expect(service.get_snapshot().context.tokens ?? 0).toBeGreaterThan(0);
    expect((context_events.at(-1)?.["context"] as JsonRecord | undefined)?.["tokens"]).toBe(
      service.get_snapshot().context.tokens,
    );

    await expect(service.reset()).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot().context).toEqual({
      tokens: null,
      compactable: false,
      limits: null,
    });
    expect(publish).toHaveBeenLastCalledWith(
      "agent.session_event",
      expect.objectContaining({ type: "snapshot_seed", snapshot: service.get_snapshot() }),
    );
  });

  it("同一对话在下一轮完整采用最新容量设置", async () => {
    const { service } = await create_service();
    await service.send_message({ text: "第一轮", attachments: [] });
    await wait_for_idle(service);

    fake_agent_state.context_window = 400_000;
    fake_agent_state.max_tokens = 50_000;
    await service.send_message({ text: "第二轮", attachments: [] });
    await wait_for_idle(service);
    expect(fake_agent_state.request_model_limits).toEqual([
      { contextWindow: 288_000, maxTokens: 32_000 },
      { contextWindow: 400_000, maxTokens: 50_000 },
    ]);
  });

  it("同一对话缩小容量后按新阈值压缩既有历史", async () => {
    const { service } = await create_service();
    for (const round of [1, 2, 3, 4]) {
      await service.send_message({
        text: `第${round.toString()}轮${"x".repeat(40_000)}`,
        attachments: [],
      });
      await wait_for_idle(service);
    }
    expect(fake_agent_state.request_kinds).not.toContain("summary");

    fake_agent_state.context_window = TEST_COMPACTION_CONTEXT_WINDOW;
    await service.send_message({ text: "继续", attachments: [] });
    await wait_for_idle(service);

    expect(fake_agent_state.request_kinds).toContain("summary");
    expect(
      JSON.stringify(
        fake_agent_state.model_contexts.at(-1)?.find((message) => message.role !== "system"),
      ),
    ).toContain("压缩摘要");
  });

  it("按上游顺序流式公开可见思考与正文，并隔离空白、脱敏内容和签名", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "thinking";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 10;

    await service.send_message({ text: "开始", attachments: [] });
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

  it("工具等待保留最近速度，失败继续先恢复均速，新回合保留历史结果", async () => {
    const { service, publish, runtime_gate } = await create_service();
    fake_agent_state.mode = "tools_error";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "查询", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
    const round_id = service.get_snapshot().entries[0]!.id;
    const waiting_speed = service.get_snapshot().tokenSpeed;
    expect(waiting_speed).toEqual({ roundId: round_id, tokensPerSecond: expect.any(Number) });
    const live_events = publish.mock.calls.flatMap(([, payload]) => {
      const event = payload as AgentSessionEvent;
      return event.type === "token_speed" ? [event.tokenSpeed] : [];
    });
    expect(live_events.at(-1)).toEqual(waiting_speed);
    expect(live_events).not.toContain(null);
    fake_agent_state.release_tool_execution?.();
    await wait_for_idle(service);
    const failed_round = service
      .get_snapshot()
      .entries.find((entry) => entry.kind === "user_message" && entry.delivery === "round")!;
    expect(failed_round).toMatchObject({
      status: "error",
      averageTokensPerSecond: expect.any(Number),
    });
    expect(service.get_snapshot().tokenSpeed).toBeNull();
    expect(publish.mock.calls).toContainEqual([
      "agent.session_event",
      expect.objectContaining({ type: "entry_upsert", entry: failed_round }),
    ]);

    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    const continue_event_start = publish.mock.calls.length;
    await service.continue_session({});
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    const resumed_speed = service.get_snapshot().tokenSpeed;
    expect(resumed_speed).toEqual({
      roundId: round_id,
      tokensPerSecond: Number(failed_round.averageTokensPerSecond!.toFixed(2)),
    });
    const continue_events = publish.mock.calls
      .slice(continue_event_start)
      .map(([, event]) => event as AgentSessionEvent);
    const speed_index = continue_events.findIndex((event) => event.type === "token_speed");
    const running_index = continue_events.findIndex(
      (event) =>
        event.type === "entry_upsert" &&
        event.entry.id === round_id &&
        event.entry.status === "running",
    );
    expect(speed_index).toBeGreaterThanOrEqual(0);
    expect(running_index).toBeGreaterThan(speed_index);
    expect(service.get_snapshot().entries[0]).toMatchObject({
      id: round_id,
      status: "running",
      averageTokensPerSecond: null,
    });
    service.stop();
    fake_agent_state.hold_idle = false;
    fake_agent_state.release_pending?.();
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
    const stopped_round = service.get_snapshot().entries[0]!;
    expect(stopped_round).toMatchObject({
      status: "stopped",
      averageTokensPerSecond: failed_round.averageTokensPerSecond,
    });
    await service.send_message({ text: "新回合", attachments: [] });
    expect(service.get_snapshot().tokenSpeed).toBeNull();
    expect(service.get_snapshot().entries[0]).toEqual(stopped_round);
    expect(service.get_snapshot().entries.at(-1)).toMatchObject({
      delivery: "round",
      averageTokensPerSecond: null,
    });
    await service.reset();
    expect(service.get_snapshot()).toMatchObject({ entries: [], tokenSpeed: null });
  });

  it("纯工具调用消息仍统计生成速度且不产生空 assistant 条目", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "tool_only";

    await service.send_message({ text: "查询", attachments: [] });
    await wait_for_idle(service);

    expect(service.get_snapshot().entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "tool_call",
    ]);
    expect(service.get_snapshot().entries[0]).toMatchObject({
      averageTokensPerSecond: expect.any(Number),
    });
    expect(service.get_snapshot().tokenSpeed).toBeNull();
  });

  it("重置期间的工具终帧归入旧会话，新会话使用独立日志身份", async () => {
    const { service, log_append } = await create_service();
    fake_agent_state.mode = "tool_only";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "旧任务", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
    const started = log_append.mock.calls
      .map(([payload]) => payload.content)
      .find((content) => content.event === "tool_start");
    const reset = service.reset();
    expect(service.get_snapshot().entries).toEqual([]);
    expect(log_append.mock.calls.some(([payload]) => payload.content.event === "run_end")).toBe(
      false,
    );
    fake_agent_state.release_tool_execution?.();
    await reset;
    const records = log_append.mock.calls.map(([payload]) => payload.content);
    expect(records.filter((content) => content.event === "tool_end")).toEqual([
      expect.objectContaining({
        session_id: started.session_id,
        run_id: started.run_id,
        tool_call_id: started.tool_call_id,
        ended_at: expect.any(String),
      }),
    ]);
    expect(records.filter((content) => content.event === "run_end")).toEqual([
      expect.objectContaining({
        session_id: started.session_id,
        run_id: started.run_id,
        status: "stopped",
      }),
    ]);
    fake_agent_state.mode = "success";
    await service.send_message({ text: "新任务", attachments: [] });
    await wait_for_idle(service);
    const latest = log_append.mock.calls.at(-1)?.[0].content;
    expect(latest).toMatchObject({ event: "run_end", status: "success" });
    expect(latest.session_id).not.toBe(started.session_id);
  });

  it("成功工具与 SDK Schema 失败都记录完整 start/end", async () => {
    const { service, log_append } = await create_service();
    fake_agent_state.mode = "tool_only";
    await service.send_message({ text: "成功查询", attachments: [] });
    await wait_for_idle(service);

    fake_agent_state.mode = "invalid_tool";
    await service.send_message({ text: "非法查询", attachments: [] });
    await wait_for_idle(service);

    const records = log_append.mock.calls.map(
      ([payload]) =>
        payload.content as {
          event: "tool_start" | "tool_end";
          tool_call_id: string;
          status?: string;
        },
    );
    expect(records.filter((record) => record.tool_call_id === "tool-only")).toEqual([
      expect.objectContaining({ event: "tool_start" }),
      expect.objectContaining({ event: "tool_end", status: "success" }),
    ]);
    expect(records.filter((record) => record.tool_call_id === "schema-invalid")).toEqual([
      expect.objectContaining({ event: "tool_start" }),
      expect.objectContaining({ event: "tool_end", status: "error" }),
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

    await service.send_message({ text: "查询", attachments: [] });
    await wait_for_idle(service);

    expect(tool_started_before_running_turn).toBe(false);
    expect(read_items).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "多个文本块", texts: ["第一块", '{"second":2}\n', ""] },
    { label: "无文本块", texts: [] },
  ])("工具终帧将 $label 原样投影到事件和快照", async ({ texts }) => {
    const content: (TextContent | ImageContent)[] = [
      ...texts.map((text): TextContent => ({ type: "text", text })),
      { type: "image", data: "image-fixture", mimeType: "image/webp" },
    ];
    const create_tools = workspace_tools.create_agent_workspace_tools;
    const mock = vi
      .spyOn(workspace_tools, "create_agent_workspace_tools")
      .mockImplementation((options) =>
        create_tools(options).map((tool) =>
          tool.name === "workspace_run"
            ? { ...tool, execute: async () => ({ content, details: {} }) }
            : tool,
        ),
      );
    try {
      const { service, publish } = await create_service();
      fake_agent_state.mode = "tool_only";
      await service.send_message({ text: "查询", attachments: [] });
      await wait_for_idle(service);
      expect(service.get_snapshot().entries).toContainEqual(
        expect.objectContaining({
          kind: "tool_call",
          status: "success",
          output: texts,
        }),
      );
      expect(publish).toHaveBeenCalledWith(
        "agent.session_event",
        expect.objectContaining({
          type: "entry_upsert",
          entry: expect.objectContaining({ kind: "tool_call", status: "success", output: texts }),
        }),
      );
    } finally {
      mock.mockRestore();
    }
  });

  it("模型回合按 user、assistant、tool_call、assistant 的真实时序追加条目", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "tools";

    await service.send_message({ text: "查询", attachments: [] });
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
          toolName: "workspace_run",
          input: JSON.stringify({ script: FAKE_WORKSPACE_SCRIPT }),
          output: null,
        }),
      }),
    );
    expect(snapshot.entries).toEqual([
      {
        kind: "user_message",
        id: expect.any(String),
        delivery: "round",
        averageTokensPerSecond: expect.any(Number),
        text: "查询",
        attachments: [],
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
        toolName: "workspace_run",
        input: JSON.stringify({ script: FAKE_WORKSPACE_SCRIPT }),
        status: "success",
        output: [expect.stringContaining('"items"')],
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
    expect(published_tool_entries).toHaveLength(2);
    expect(
      published_tool_entries.every(
        (entry) =>
          !("args" in entry) &&
          !("details" in entry) &&
          typeof entry["input"] === "string" &&
          "output" in entry,
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
        event["type"] === "context",
    );
    expect(first_tool_success_index).toBeGreaterThan(-1);
    expect(next_assistant_index).toBeGreaterThan(first_tool_success_index);
    expect(tool_result_usage_index).toBeGreaterThan(first_tool_success_index);
  });

  it("真实 Agent 将流终态错误封口到轮次，并让 prompt 正常结束", async () => {
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "error";

    await service.send_message({
      text: "开始",
      attachments: [uploaded_file("webp-image")],
    });
    await wait_for_idle(service);

    expect(log_error).toHaveBeenCalledWith(
      "Agent 模型回合失败 …",
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
          text: "开始",
          attachments: [uploaded_file("webp-image")],
          status: "error",
          endedAt: expect.any(Number),
        },
      ],
    });
  });

  it("产品会话身份跨修订和换模保留，reset 与工程切换后更换", async () => {
    const fixture = await create_service();
    const { service } = fixture;
    await service.send_message({ text: "原任务", attachments: [] });
    await wait_for_idle(service);
    const identity = agent_model_registrar.mock.calls[0]?.[2];
    expect(identity).toEqual({ user_agent: "LinguaGacha/Test", session_id: expect.any(String) });
    const user = service.get_snapshot().entries.findLast((entry) => entry.kind === "user_message");
    if (user === undefined) throw new Error("缺少 user 条目");
    await service.revise_latest_round({
      entryId: user.id,
      message: { text: user.text, attachments: [] },
    });
    await wait_for_idle(service);
    fixture.select_agent_model("next");
    await service.send_message({ text: "继续", attachments: [] });
    await wait_for_idle(service);
    for (const call of agent_model_registrar.mock.calls) expect(call[2]).toEqual(identity);

    await service.reset();
    await service.send_message({ text: "新对话", attachments: [] });
    await wait_for_idle(service);
    const reset_identity = agent_model_registrar.mock.calls.at(-1)?.[2];
    expect(reset_identity.session_id).not.toBe(identity.session_id);

    await fixture.session_state.mark_loaded("next.lg");
    await service.send_message({ text: "新工程", attachments: [] });
    await wait_for_idle(service);
    const project_identity = agent_model_registrar.mock.calls.at(-1)?.[2];
    expect(project_identity.session_id).not.toBe(reset_identity.session_id);
  });

  it("以相同 user 输入修订轮次时删除旧尝试并重新调用模型", async () => {
    const { service } = await create_service();
    await service.send_message({ text: "原任务", attachments: [] });
    await wait_for_idle(service);
    const user = service.get_snapshot().entries.find((entry) => entry.kind === "user_message");
    if (user === undefined) throw new Error("缺少 user 条目");

    await service.revise_latest_round({
      entryId: user.id,
      message: { text: user.text, attachments: user.attachments },
    });
    await wait_for_idle(service);

    const snapshot = service.get_snapshot();
    expect(snapshot.entries.filter((entry) => entry.kind === "user_message")).toHaveLength(1);
    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_message", text: "原任务", status: "success" }),
        expect.objectContaining({ kind: "assistant_message", status: "success" }),
      ]),
    );
    expect(fake_agent_state.prompts).toEqual(["原任务", "原任务"]);
    expect(
      fake_agent_state.model_contexts
        .at(-1)
        ?.filter(
          (message) => message.role === "user" && JSON.stringify(message).includes("原任务"),
        ),
    ).toHaveLength(1);
  });

  it("修订历史后保留整个产品对话的累计用量，重置时清零", async () => {
    const { service, publish } = await create_service();
    await service.send_message({ text: "原任务", attachments: [] });
    await wait_for_idle(service);
    const user = service.get_snapshot().entries.find((entry) => entry.kind === "user_message");
    if (user === undefined) throw new Error("缺少 user 条目");
    const first_usage = service.get_snapshot().usage;
    expect(first_usage.input).toBeGreaterThan(0);
    expect(first_usage.output).toBeGreaterThan(0);

    await service.revise_latest_round({
      entryId: user.id,
      message: { text: "重试任务", attachments: [] },
    });
    await wait_for_idle(service);
    const revised_usage = service.get_snapshot().usage;
    expect(revised_usage.input).toBeGreaterThan(first_usage.input);
    expect(revised_usage.output).toBe(first_usage.output * 2);
    expect(revised_usage.cacheWrite).toBeGreaterThan(first_usage.cacheWrite);
    expect(publish.mock.calls.some(([, event]) => event["type"] === "usage")).toBe(true);

    const revised_user = service
      .get_snapshot()
      .entries.find((entry) => entry.kind === "user_message");
    if (revised_user === undefined) throw new Error("缺少修订后的 user 条目");
    await service.revise_latest_round({
      entryId: revised_user.id,
      message: { text: "再次重试", attachments: [] },
    });
    await wait_for_idle(service);
    expect(service.get_snapshot().usage.output).toBe(first_usage.output * 3);

    await service.reset();
    expect(service.get_snapshot().usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("恢复失败轮次时保留公开工具历史，并以隐藏消息继续原 user", async () => {
    const { service } = await create_service(true);
    fake_agent_state.mode = "tools_error";
    await service.send_message({ text: "原任务", attachments: [] });
    await wait_for_idle(service);
    const failed_entries = service.get_snapshot().entries;
    const failed_user = failed_entries.find((entry) => entry.kind === "user_message");
    const failed_assistant = failed_entries.findLast(
      (entry) => entry.kind === "assistant_message" && entry.status === "error",
    );
    const failed_tool_ids = failed_entries
      .filter((entry) => entry.kind === "tool_call")
      .map((entry) => entry.id);
    if (
      failed_user === undefined ||
      failed_assistant === undefined ||
      failed_tool_ids.length === 0
    ) {
      throw new Error("缺少失败轮次条目");
    }

    fake_agent_state.mode = "success";
    await expect(service.continue_session({})).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot().state).toBe("running");
    await wait_for_idle(service);

    const snapshot = service.get_snapshot();
    expect(snapshot.entries.filter((entry) => entry.kind === "user_message")).toEqual([
      expect.objectContaining({ id: failed_user.id, text: "原任务", status: "success" }),
    ]);
    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: failed_assistant.id, status: "error" }),
        expect.objectContaining({ kind: "assistant_message", status: "success" }),
      ]),
    );
    expect(
      snapshot.entries.filter((entry) => entry.kind === "tool_call").map((entry) => entry.id),
    ).toEqual(failed_tool_ids);
    expect(fake_agent_state.prompts.at(-1)).toBe("继续");
    expect(
      fake_agent_state.model_contexts.at(-1)?.some((message) => message.role === "toolResult"),
    ).toBe(true);
  });

  it("修改最新 user 后删除原输入并重新调用模型", async () => {
    const { service } = await create_service();
    await service.send_message({
      text: "原输入",
      attachments: [uploaded_file("old-image")],
    });
    await wait_for_idle(service);
    const user = service.get_snapshot().entries.findLast((entry) => entry.kind === "user_message");
    if (user === undefined) throw new Error("缺少可修改 user 条目");

    await service.revise_latest_round({
      entryId: user.id,
      message: {
        text: "新输入",
        attachments: [uploaded_file("new-image")],
      },
    });
    await wait_for_idle(service);

    const entries = service.get_snapshot().entries;
    expect(entries[0]).toMatchObject({
      kind: "user_message",
      text: "新输入",
      attachments: [uploaded_file("new-image")],
      status: "success",
    });
    expect(entries.filter((entry) => entry.kind === "user_message")).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === "assistant_message")).toHaveLength(1);
    expect(fake_agent_state.prompts).toEqual([
      expect.stringContaining("原输入"),
      expect.stringContaining("新输入"),
    ]);
    expect(JSON.stringify(fake_agent_state.model_contexts.at(-1))).not.toContain("原输入");
  });

  it("修改最新 assistant 不调用模型，并保留此前完整工具历史", async () => {
    const { service } = await create_service(true);
    fake_agent_state.mode = "tools";
    await service.send_message({ text: "开始", attachments: [] });
    await wait_for_idle(service);
    const assistants = service
      .get_snapshot()
      .entries.filter((entry) => entry.kind === "assistant_message");
    const intermediate_assistant = assistants[0];
    const assistant = assistants.at(-1);
    if (intermediate_assistant === undefined || assistant === undefined) {
      throw new Error("缺少可修改 assistant 条目");
    }
    const calls_before_edit = fake_agent_state.model_call_count;

    await expect(
      service.revise_latest_round({
        entryId: intermediate_assistant.id,
        message: { text: "越过最终输出", attachments: [] },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.revise_latest_round({
        entryId: assistant.id,
        message: {
          text: "",
          attachments: [uploaded_file("image")],
        },
      }),
    ).rejects.toThrow("request.validation_failed");

    await service.revise_latest_round({
      entryId: assistant.id,
      message: { text: "人工修订", attachments: [] },
    });

    expect(fake_agent_state.model_call_count).toBe(calls_before_edit);
    expect(service.get_snapshot().entries.at(-1)).toMatchObject({
      kind: "assistant_message",
      parts: [{ kind: "text", text: "人工修订" }],
      status: "success",
    });

    fake_agent_state.mode = "success";
    await service.send_message({ text: "下一轮", attachments: [] });
    await wait_for_idle(service);
    const next_context = JSON.stringify(fake_agent_state.model_contexts.at(-1));
    expect(next_context).toContain("人工修订");
    expect(next_context).toContain('"role":"toolResult"');
    expect(next_context).not.toContain("查询完成");
  });

  it("过期目标身份拒绝改写当前历史", async () => {
    const { service } = await create_service();
    await service.send_message({ text: "当前任务", attachments: [] });
    await wait_for_idle(service);
    const before = service.get_snapshot();

    await expect(service.continue_session({})).rejects.toThrow("request.validation_failed");
    await expect(
      service.revise_latest_round({
        entryId: "stale",
        message: { text: "越权修改", attachments: [] },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(service.get_snapshot()).toEqual(before);
    expect(fake_agent_state.model_call_count).toBe(1);
  });

  it("工程会话切换仍清空会话", async () => {
    const { service, publish, session_state } = await create_service();

    await service.send_message({ text: "开始", attachments: [] });
    await wait_for_idle(service);
    await session_state.mark_loaded("next.lg");

    expect(service.get_snapshot()).toEqual({
      sessionId: expect.any(String),
      revision: expect.any(Number),
      state: "idle",
      approvalMode: "manual",
      pendingDecision: null,
      entries: [],
      skills: skill_test_fixture.snapshots,
      inputQueue: { paused: false, canSendNow: false, items: [] },
      todos: [],
      tokenSpeed: null,
      context: { tokens: null, compactable: false, limits: null },
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(count_published_events(publish, "snapshot_seed")).toBe(1);
  });

  it("真实 Agent 恒定注册工作区工具与运行时 System", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "success";

    await service.send_message({ text: '@skill("glossary-audit") 写入', attachments: [] });
    await wait_for_idle(service);
    expect([...(fake_agent_state.tool_names.at(-1) ?? [])].sort()).toEqual(
      [
        "run_batch_item_translation",
        "ask_user",
        "workspace_run",
        "workspace_apply",
        "read_skill",
      ].sort(),
    );
    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(service.get_snapshot().entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "assistant_message",
    ]);
  });

  it("Node Todo 跨普通回合保留、公开投影并随 Agent reset 清空", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "todo_write";

    await service.send_message({ text: "开始长任务", attachments: [] });
    await wait_for_idle(service);
    expect(service.get_snapshot().todos).toEqual(["基础扫描"]);
    expect(publish).toHaveBeenCalledWith(
      "agent.session_event",
      expect.objectContaining({ type: "todo", todos: ["基础扫描"] }),
    );

    fake_agent_state.mode = "todo_read";
    await service.send_message({ text: "下一回合读取 Todo", attachments: [] });
    await wait_for_idle(service);
    expect(read_tool_output(service, "todo-read")).toEqual(
      workspace_execution({ todos: ["基础扫描"] }),
    );

    fake_agent_state.mode = "todo_clear";
    await service.send_message({ text: "完成剩余工作", attachments: [] });
    await wait_for_idle(service);
    expect(service.get_snapshot().todos).toEqual([]);

    fake_agent_state.mode = "todo_write";
    await service.send_message({ text: "建立重置基线", attachments: [] });
    await wait_for_idle(service);
    await service.reset();
    expect(service.get_snapshot().todos).toEqual([]);
    fake_agent_state.mode = "todo_read";
    await service.send_message({ text: "读取 Todo", attachments: [] });
    await wait_for_idle(service);

    expect(read_tool_output(service, "todo-read")).toEqual(workspace_execution({ todos: [] }));
  });

  it("仅在宿主搜索能力可用时注册 web_search", async () => {
    const web_search = vi.fn<AgentWebSearchPort>(async () => ({
      provider: "exa",
      text: "搜索结果",
    }));
    const { service } = await create_service(true, web_search);

    await service.send_message({ text: "读取网页", attachments: [] });
    await wait_for_idle(service);

    expect(fake_agent_state.tool_names.at(-1)).toContain("web_search");
  });

  it("Electron 工作区端口初始化并区分会话与工程 reset", async () => {
    const workspace = {
      uploads: fake_uploads(),
      list_files: () => [],
      initialize: vi.fn(async () => undefined),
      activate_path: vi.fn(async () => ({ status: "cancelled" as const })),
      invalidate_links: vi.fn(),
      reset_workspace: vi.fn(async () => undefined),
      reset_project: vi.fn(async () => undefined),
      run: vi.fn(async (_script, todos) => ({
        images: [],
        execution: workspace_execution(),
        todos: [...todos],
      })),
      apply_workspace: vi.fn(),
    } satisfies AgentWorkspacePort;
    const { service, session_state } = await create_service(true, undefined, workspace);

    await service.send_message({ text: "批量处理", attachments: [] });
    await wait_for_idle(service);

    expect(workspace.initialize).toHaveBeenCalledOnce();
    await expect(service.activate_workspace_path({ path: "work/report.md" })).resolves.toEqual({
      status: "cancelled",
    });
    expect(workspace.activate_path).toHaveBeenCalledWith("work/report.md");
    const reset = service.reset();
    expect(workspace.invalidate_links).toHaveBeenCalledOnce();
    await expect(service.activate_workspace_path({ path: "work/report.md" })).rejects.toMatchObject(
      { code: "runtime.busy" },
    );
    await reset;
    expect(workspace.reset_workspace).toHaveBeenCalledOnce();
    await session_state.mark_loaded("next.lg");
    expect(workspace.reset_project).toHaveBeenCalledWith("next.lg");
    const invalidations = workspace.invalidate_links.mock.calls.length;
    const dispose = service.dispose();
    expect(workspace.invalidate_links).toHaveBeenCalledTimes(invalidations + 1);
    await dispose;
  });

  it("停止会中断当前回合并回到 idle，主动 abort 不上报请求失败", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "开始", attachments: [] });
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(13_500);
    const stopped_ack = service.stop();
    const stopped_snapshot = service.get_snapshot();
    expect(stopped_ack).toEqual({ revision: stopped_snapshot.revision });
    expect(stopped_snapshot).toMatchObject({
      state: "idle",
      entries: [{ kind: "user_message", createdAt: 1_000, endedAt: 13_500 }],
    });
    expect(stopped_snapshot.context.tokens).toEqual(expect.any(Number));
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

    await service.send_message({ text: "开始", attachments: [] });
    await vi.advanceTimersByTimeAsync(25);
    service.stop();
    const stopped_snapshot = service.get_snapshot();
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
    expect(service.get_snapshot().tokenSpeed).toEqual(stopped_snapshot.tokenSpeed);
    expect(log_error).not.toHaveBeenCalled();
  });

  it("停止会封口普通运行工具，迟到结果不能改写历史", async () => {
    const { service, runtime_gate } = await create_service();
    fake_agent_state.mode = "todo_write";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "查询", attachments: [] });
    await vi.waitFor(() => {
      expect(service.get_snapshot().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "tool_call", id: "todo-write", status: "running" }),
        ]),
      );
    });

    service.stop();
    const stopped_entries = service.get_snapshot().entries;
    expect(stopped_entries).toEqual([
      expect.objectContaining({ kind: "user_message", status: "stopped" }),
      expect.objectContaining({
        kind: "tool_call",
        id: "todo-write",
        status: "stopped",
        output: null,
      }),
    ]);

    fake_agent_state.release_tool_execution?.();
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
    expect(service.get_snapshot().entries).toEqual(stopped_entries);
    expect(service.get_snapshot().todos).toEqual([]);
  });

  it("workspace_apply 运行期间拒绝停止，提交终帧仍成为唯一结果", async () => {
    const { service, runtime_gate, log_append } = await create_service();
    service.set_approval_mode({ approvalMode: "auto" });
    fake_agent_state.mode = "write";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "写入", attachments: [] });
    await vi.waitFor(() => {
      expect(service.get_snapshot().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "tool_call", id: "write-1", status: "running" }),
        ]),
      );
    });

    expect(() => service.stop()).toThrow("runtime.busy");
    expect(service.get_snapshot()).toMatchObject({ state: "running" });

    fake_agent_state.release_tool_execution?.();
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool_call", id: "write-1", status: "success" }),
      ]),
    );
    expect(
      log_append.mock.calls
        .map(([payload]) => payload.content as JsonRecord)
        .filter((record) => record["tool_call_id"] === "write-1"),
    ).toEqual([
      expect.objectContaining({ event: "tool_start" }),
      expect.objectContaining({ event: "tool_end" }),
    ]);
  });

  it("SDK preflight 尚未结束时 stop 也不会迟到启动模型请求", async () => {
    const { service, log_error } = await create_service();
    fake_agent_state.hold_auth = true;
    await service.send_message({ text: "立即停止", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_auth).not.toBeNull());

    expect(service.stop()).toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot().state).toBe("idle");
    fake_agent_state.release_auth?.();
    await vi.waitFor(() => expect(fake_agent_state.release_auth).toBeNull());
    await Promise.resolve();

    expect(fake_agent_state.model_call_count).toBe(0);
    expect(log_error).not.toHaveBeenCalled();
  });

  it("reset 会立即隔离并等待 SDK preflight 真正 settle", async () => {
    const { service } = await create_service();
    fake_agent_state.hold_auth = true;
    await service.send_message({ text: "立即重置", attachments: [] });
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
    await expect(resetting).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    expect(fake_agent_state.model_call_count).toBe(0);
  });

  it("运行中重置立即隔离旧会话，并在旧回合退出后创建全新上下文", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    await service.send_message({ text: '@skill("corpus-search") 旧任务', attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());

    let settled = false;
    const resetting = service.reset().then((snapshot) => {
      settled = true;
      return snapshot;
    });
    expect(fake_agent_state.abort_count).toBe(1);
    expect(service.get_snapshot()).toEqual({
      sessionId: expect.any(String),
      revision: expect.any(Number),
      state: "idle",
      approvalMode: "manual",
      pendingDecision: null,
      entries: [],
      skills: skill_test_fixture.snapshots,
      inputQueue: { paused: false, canSendNow: false, items: [] },
      todos: [],
      tokenSpeed: null,
      context: { tokens: null, compactable: false, limits: null },
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    let resetting_error: unknown;
    try {
      await service.send_message({ text: "过早的新任务", attachments: [] });
    } catch (error) {
      resetting_error = error;
    }
    expect(resetting_error).toMatchObject({
      code: "runtime.busy",
    });
    expect(service.get_snapshot().entries).toEqual([]);

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_pending?.();
    await expect(resetting).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    expect(publish).toHaveBeenLastCalledWith(
      "agent.session_event",
      expect.objectContaining({ type: "snapshot_seed", snapshot: service.get_snapshot() }),
    );
    fake_agent_state.mode = "success";
    await service.send_message({ text: "新任务", attachments: [] });
    await wait_for_idle(service);

    expect(service.get_snapshot().entries.filter((entry) => entry.kind === "user_message")).toEqual(
      [expect.objectContaining({ text: "新任务" })],
    );
  });

  it("reset 丢弃窗口内 pending 正文且不发布迟到事件", async () => {
    vi.useFakeTimers();
    const { service, publish } = await create_service();
    fake_agent_state.mode = "streaming";
    fake_agent_state.stream_token_size = 1;
    fake_agent_state.stream_tokens_per_second = 40;

    await service.send_message({ text: "旧任务", attachments: [] });
    await vi.advanceTimersByTimeAsync(25);
    const resetting = service.reset();
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    await vi.runAllTimersAsync();
    await expect(resetting).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    const seed_index = publish.mock.calls.findLastIndex(
      ([, payload]) => payload["type"] === "snapshot_seed",
    );
    expect(seed_index).toBeGreaterThan(-1);
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

    await service.send_message({ text: "旧任务", attachments: [] });
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
    await service.send_message({ text: "旧任务", attachments: [] });
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

  it("技能引用进入消息历史后，普通回合继续使用稳定 system prompt", async () => {
    const { service } = await create_service();

    await service.send_message({ text: '@skill("glossary-audit") 审校', attachments: [] });
    await wait_for_idle(service);
    await service.send_message({ text: "普通对话", attachments: [] });
    await wait_for_idle(service);

    expect(fake_agent_state.system_prompts.at(-1)).toBe(fake_agent_state.system_prompts.at(-2));
    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(fake_agent_state.prompts.at(-2)).not.toContain(
      skill_test_fixture.fixture_contents.glossary_audit,
    );
    expect(fake_agent_state.prompts.at(-1)).toBe("普通对话");
  });

  it("空闲回合之间重绑定 Agent 模型并保留历史", async () => {
    const { service, select_agent_model } = await create_service();

    await service.send_message({ text: "第一轮", attachments: [] });
    await wait_for_idle(service);
    select_agent_model("next");
    await service.send_message({ text: "第二轮", attachments: [] });
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

    await expect(service.send_message({ text: "不会受理", attachments: [] })).rejects.toThrow(
      "模型解析失败",
    );

    expect(service.get_snapshot()).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
    expect(fake_agent_state.model_call_count).toBe(0);
  });

  it("换模鉴权失败时保留原公开快照", async () => {
    const { service, select_agent_model } = await create_service();
    await service.send_message({ text: "第一轮", attachments: [] });
    await wait_for_idle(service);
    const before = service.get_snapshot();
    select_agent_model("next");
    fake_agent_state.auth_configured = false;

    await expect(service.send_message({ text: "不会追加", attachments: [] })).rejects.toThrow(
      "No API key",
    );

    expect(service.get_snapshot()).toEqual(before);
    expect(fake_agent_state.model_call_count).toBe(1);
  });

  it("消息修改预检失败时不裁剪公开时间线或模型历史", async () => {
    const { service } = await create_service();
    await service.send_message({ text: "第一轮", attachments: [] });
    await wait_for_idle(service);
    const before = service.get_snapshot();
    const assistant = before.entries.findLast((entry) => entry.kind === "assistant_message");
    if (assistant === undefined) throw new Error("缺少 assistant 条目");
    fake_agent_state.auth_configured = false;

    await expect(
      service.revise_latest_round({
        entryId: assistant.id,
        message: { text: "不会提交", attachments: [] },
      }),
    ).rejects.toThrow("No API key");

    expect(service.get_snapshot()).toEqual(before);
    expect(fake_agent_state.model_call_count).toBe(1);
  });

  it("创建运行时期间 stop 会令候选失效且不产生公开受理事实", async () => {
    const { service } = await create_service();

    const sending = service.send_message({ text: "不会启动", attachments: [] });
    expect(service.stop()).toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });

    await expect(sending).rejects.toMatchObject({
      diagnostic_context: { reason: "agent_message_invalidated" },
    });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    expect(fake_agent_state.model_call_count).toBe(0);
  });

  it("换模期间 stop 会关闭候选运行时并保留既有公开历史", async () => {
    const { service, select_agent_model } = await create_service();
    await service.send_message({ text: "既有历史", attachments: [] });
    await wait_for_idle(service);
    const entries_before = service.get_snapshot().entries;
    select_agent_model("next");
    fake_agent_state.hold_auth = true;

    const switching = service.send_message({ text: "不会受理", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_auth).not.toBeNull());
    expect(service.stop()).toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: entries_before });
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

    await service.send_message({ text: "重试", attachments: [] });
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

  it.each(["overflow", "length"] as const)(
    "%s 恢复失败按当前运行结算并暂停队列，继续时不重放废弃响应",
    async (mode) => {
      const { service } = await create_service();
      await prepare_manual_compaction_history(service);
      fake_agent_state.mode = mode;
      fake_agent_state.hold_next_summary = true;
      fake_agent_state.summary_failures_remaining = 1;

      await service.send_message({ text: "触发恢复", attachments: [] });
      await vi.waitFor(() => expect(fake_agent_state.release_summary).not.toBeNull());
      await service.send_message({ text: "排队工作", attachments: [] });
      fake_agent_state.release_summary?.();
      await wait_for_idle(service);

      expect(service.get_snapshot()).toMatchObject({
        inputQueue: { paused: true, items: [{ text: "排队工作" }] },
      });
      expect(
        service.get_snapshot().entries.findLast((entry) => entry.kind === "user_message"),
      ).toMatchObject({ text: "触发恢复", status: "error" });
      expect(fake_agent_state.prompts).not.toContain("排队工作");

      await service.continue_session({});
      await wait_for_idle(service);
      expect(JSON.stringify(fake_agent_state.model_contexts)).not.toContain("废弃的恢复尝试");
      expect(service.get_snapshot()).toMatchObject({ inputQueue: { paused: false, items: [] } });
      expect(
        service.get_snapshot().entries.findLast((entry) => entry.kind === "user_message"),
      ).toMatchObject({ text: "排队工作", status: "success" });
    },
  );

  it("溢出恢复成功后再次压缩和请求都不恢复废弃响应", async () => {
    const { service, log_error } = await create_service();
    await prepare_manual_compaction_history(service);
    fake_agent_state.mode = "overflow";

    await service.send_message({ text: "触发恢复", attachments: [] });
    await wait_for_idle(service);
    expect(
      service.get_snapshot().entries.findLast((entry) => entry.kind === "user_message"),
    ).toMatchObject({ text: "触发恢复", status: "success" });

    await service.send_message({ text: `后续材料${"x".repeat(80_000)}`, attachments: [] });
    await wait_for_idle(service);
    await service.compact_context();
    await vi.waitFor(() =>
      expect(service.get_snapshot().entries.at(-1)).toMatchObject({
        kind: "context_compaction",
        status: "success",
      }),
    );
    await service.send_message({ text: "压缩后继续", attachments: [] });
    await wait_for_idle(service);

    expect(fake_agent_state.summary_contexts.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(fake_agent_state.summary_contexts)).not.toContain("废弃的恢复尝试");
    expect(JSON.stringify(fake_agent_state.model_contexts)).not.toContain("废弃的恢复尝试");
    expect(log_error).not.toHaveBeenCalled();
  });

  it("重试等待期间 stop 会取消后续调用且不报告失败", async () => {
    vi.useFakeTimers();
    const { service, log_error } = await create_service();
    fake_agent_state.mode = "retry";
    fake_agent_state.retry_failures_remaining = 1;
    await service.send_message({ text: "取消重试", attachments: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake_agent_state.model_call_count).toBe(1);

    expect(service.stop()).toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot().state).toBe("idle");
    await vi.runAllTimersAsync();

    expect(fake_agent_state.model_call_count).toBe(1);
    expect(log_error).not.toHaveBeenCalled();
  });

  it("空闲会话手动压缩旧历史，不创建模型轮次并更新上下文可用性", async () => {
    const { service } = await create_service();
    await prepare_manual_compaction_history(service);
    const before = service.get_snapshot();
    const visible_entries = before.entries.filter((entry) => entry.kind !== "context_compaction");
    const model_calls = fake_agent_state.request_kinds.filter((kind) => kind === "model").length;
    expect(before.context.compactable).toBe(true);

    await expect(service.compact_context()).resolves.toEqual({ revision: expect.any(Number) });
    await vi.waitFor(() =>
      expect(service.get_snapshot().entries.at(-1)).toMatchObject({
        kind: "context_compaction",
        status: "success",
      }),
    );

    const after = service.get_snapshot();
    expect(after.state).toBe("idle");
    expect(after.context.compactable).toBe(false);
    expect(after.context.tokens ?? Number.POSITIVE_INFINITY).toBeLessThan(before.context.tokens!);
    expect(after.entries.filter((entry) => entry.kind !== "context_compaction")).toEqual(
      visible_entries,
    );
    expect(fake_agent_state.request_kinds.filter((kind) => kind === "model")).toHaveLength(
      model_calls,
    );
    expect(fake_agent_state.request_kinds.at(-1)).toBe("summary");
  });

  it("手动压缩在公开 running 条目后返回回执，并由后台结算终态", async () => {
    const { service, runtime_gate } = await create_service();
    await prepare_manual_compaction_history(service);
    fake_agent_state.hold_next_summary = true;
    let acknowledgement: AgentCommandAck | undefined;

    const request = service.compact_context().then((accepted) => {
      acknowledgement = accepted;
    });
    await vi.waitFor(() => expect(fake_agent_state.release_summary).not.toBeNull());
    await vi.waitFor(() => expect(acknowledgement).toEqual({ revision: expect.any(Number) }));

    expect(service.get_snapshot().entries.at(-1)).toMatchObject({
      kind: "context_compaction",
      status: "running",
    });
    expect(runtime_gate.get_snapshot().owner).toBe("agent");

    fake_agent_state.release_summary?.();
    await request;
    await vi.waitFor(() =>
      expect(service.get_snapshot().entries.at(-1)).toMatchObject({
        kind: "context_compaction",
        status: "success",
      }),
    );
    expect(runtime_gate.get_snapshot().owner).toBeNull();
  });

  it("手动压缩失败保留历史与重试能力并释放运行 lease", async () => {
    const { service, runtime_gate } = await create_service();
    await prepare_manual_compaction_history(service);
    const before = service.get_snapshot();
    fake_agent_state.summary_failures_remaining = 100;

    await expect(service.compact_context()).resolves.toEqual({ revision: expect.any(Number) });
    await vi.waitFor(() =>
      expect(service.get_snapshot().entries.at(-1)).toMatchObject({
        kind: "context_compaction",
        status: "error",
      }),
    );

    const failed = service.get_snapshot();
    expect(failed.context).toEqual(before.context);
    expect(runtime_gate.get_snapshot().owner).toBeNull();

    fake_agent_state.summary_failures_remaining = 0;
    await expect(service.compact_context()).resolves.toEqual({ revision: expect.any(Number) });
    await vi.waitFor(() =>
      expect(service.get_snapshot().entries.at(-1)).toMatchObject({
        kind: "context_compaction",
        status: "success",
      }),
    );
  });

  it("reset 等待已受理的手动压缩退出后发布空会话", async () => {
    const { service, runtime_gate } = await create_service();
    await prepare_manual_compaction_history(service);
    fake_agent_state.hold_next_summary = true;
    fake_agent_state.hold_idle = true;
    await service.compact_context();
    await vi.waitFor(() => expect(fake_agent_state.release_summary).not.toBeNull());

    let reset_settled = false;
    const reset = service.reset().then((acknowledgement) => {
      reset_settled = true;
      return acknowledgement;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reset_settled).toBe(false);

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_summary?.();
    await expect(reset).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot()).toMatchObject({
      state: "idle",
      entries: [],
      context: { tokens: null, compactable: false, limits: null },
    });
    expect(runtime_gate.get_snapshot().owner).toBeNull();
  });

  it("运行中与历史不足固定保留量时拒绝手动压缩", async () => {
    const { service } = await create_service();
    await expect(service.compact_context()).rejects.toThrow("request.validation_failed");

    await service.send_message({ text: "短历史", attachments: [] });
    await wait_for_idle(service);
    expect(service.get_snapshot().context.compactable).toBe(false);
    await expect(service.compact_context()).rejects.toThrow("request.validation_failed");

    fake_agent_state.mode = "pending";
    await service.send_message({ text: "持续运行", attachments: [] });
    await vi.waitFor(() => expect(service.get_snapshot().state).toBe("running"));
    await expect(service.compact_context()).rejects.toThrow("runtime.busy");
    service.stop();
  });

  it("高用量回答触发阈值压缩，公开时间线不缩水且下一轮从摘要继续", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.context_window = TEST_COMPACTION_CONTEXT_WINDOW;
    for (const round of [1, 2, 3, 4, 5]) {
      await service.send_message({
        text: `第${round.toString()}轮${"x".repeat(40_000)}`,
        attachments: [],
      });
      await wait_for_idle(service);
    }
    const after_compaction = service.get_snapshot();
    const usage_tokens = publish.mock.calls.flatMap(([, event]) =>
      event["type"] === "context" ? [Number((event["context"] as JsonRecord)["tokens"])] : [],
    );

    expect(fake_agent_state.request_kinds).toContain("summary");
    expect(
      after_compaction.entries.filter((entry) => entry.kind !== "context_compaction"),
    ).toHaveLength(10);
    expect(after_compaction.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "context_compaction", status: "success" }),
      ]),
    );

    await service.send_message({ text: "继续", attachments: [] });
    await wait_for_idle(service);
    const next_context = fake_agent_state.model_contexts.at(-1);
    expect(JSON.stringify(next_context?.find((message) => message.role !== "system"))).toContain(
      "压缩摘要",
    );
    expect(JSON.stringify(next_context)).toContain("第5轮");
    expect(service.get_snapshot().context.tokens ?? Number.POSITIVE_INFINITY).toBeLessThan(
      Math.max(...usage_tokens),
    );
    expect(
      service.get_snapshot().entries.filter((entry) => entry.kind !== "context_compaction"),
    ).toHaveLength(12);
  });

  it("长工具结果跨阈值后保留调用配对，压缩并继续同一轮次", async () => {
    const { service, read_items } = await create_service();
    await prepare_long_tool_history(service, read_items);
    expect(fake_agent_state.request_kinds).not.toContain("summary");
    const requests_before_compaction = fake_agent_state.request_kinds.length;
    fake_agent_state.mode = "tool_compaction";

    await service.send_message({ text: "检查长条目", attachments: [] });
    await wait_for_idle(service);

    const compaction_requests = fake_agent_state.request_kinds.slice(requests_before_compaction);
    expect(compaction_requests[0]).toBe("model");
    expect(compaction_requests).toContain("summary");
    expect(compaction_requests.at(-1)).toBe("model");
    expect(compaction_requests.filter((kind) => kind === "model")).toHaveLength(2);
    expect(fake_agent_state.prompts.at(-1)).toBe("检查长条目");
    expect(read_items).toHaveBeenCalledOnce();
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "context_compaction", status: "success" }),
        expect.objectContaining({
          kind: "assistant_message",
          parts: [{ kind: "text", text: "压缩后完成" }],
          status: "success",
        }),
      ]),
    );
    expect(
      service
        .get_snapshot()
        .entries.filter((entry) => entry.kind === "user_message" && entry.text === "检查长条目"),
    ).toHaveLength(1);

    const resumed_context = fake_agent_state.model_contexts.at(-1) ?? [];
    const call_index = resumed_context.findIndex(
      (message) =>
        message.role === "assistant" &&
        JSON.stringify(message.content).includes("tool-compaction-query"),
    );
    const result_index = resumed_context.findIndex(
      (message) => message.role === "toolResult" && message.toolCallId === "tool-compaction-query",
    );
    expect(call_index).toBeGreaterThanOrEqual(0);
    expect(result_index).toBeGreaterThan(call_index);
  });

  it("工具轮次压缩后优先消费待发送 steer", async () => {
    const { service, read_items } = await create_service();
    await prepare_long_tool_history(service, read_items);
    const prompts_before = fake_agent_state.prompts.length;
    fake_agent_state.mode = "tool_compaction";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "检查长条目", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
    await service.send_message({ text: "插队优先", attachments: [] });
    const queued = service.get_snapshot();
    await vi.waitFor(() => expect(service.get_snapshot().inputQueue.canSendNow).toBe(true));
    await service.send_queued_message({ id: queued.inputQueue.items[0]!.id });

    fake_agent_state.mode = "success";
    fake_agent_state.release_tool_execution?.();
    await wait_for_idle(service);

    const prompts = fake_agent_state.prompts.slice(prompts_before);
    expect(prompts).toContain("插队优先");
    expect(prompts).not.toContain("继续");
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "context_compaction", status: "success" }),
        expect.objectContaining({
          kind: "user_message",
          delivery: "steer",
          text: "插队优先",
        }),
      ]),
    );
  });

  it("同一 run 压缩结束后恢复队列即时发送能力", async () => {
    const { service, read_items, publish } = await create_service();
    await prepare_long_tool_history(service, read_items);
    fake_agent_state.mode = "tool_compaction";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "检查长条目", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
    await service.send_message({ text: "等待发送", attachments: [] });

    fake_agent_state.mode = "success";
    fake_agent_state.release_tool_execution?.();
    await wait_for_idle(service);

    const events = publish.mock.calls.map(([, event]) => event as AgentSessionEvent);
    const compaction_end_index = events.findIndex(
      (event) =>
        event.type === "entry_upsert" &&
        event.entry.kind === "context_compaction" &&
        event.entry.status === "success",
    );
    expect(
      events
        .slice(compaction_end_index + 1)
        .some((event) => event.type === "input_queue" && event.inputQueue.canSendNow),
    ).toBe(true);
  });

  it("自动压缩失败只公开诊断，下一请求由 SDK 自动重试", async () => {
    const { service, read_items, log_error, log_warning } = await create_service();
    await prepare_long_tool_history(service, read_items);
    fake_agent_state.mode = "tool_compaction";
    fake_agent_state.summary_failures_remaining = 100;
    const calls_before_compaction = fake_agent_state.model_call_count;

    await service.send_message({ text: "检查长条目", attachments: [] });
    await wait_for_idle(service);

    const failed_compaction = service
      .get_snapshot()
      .entries.findLast((entry) => entry.kind === "context_compaction");
    expect(
      service.get_snapshot().entries.findLast((entry) => entry.kind === "user_message"),
    ).toMatchObject({ text: "检查长条目", status: "success" });
    expect(failed_compaction).toMatchObject({ status: "error" });
    expect(fake_agent_state.model_call_count - calls_before_compaction).toBe(2);
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assistant_message",
          parts: [{ kind: "text", text: "未压缩继续" }],
          status: "success",
        }),
      ]),
    );
    expect(log_warning).toHaveBeenCalledWith(
      "Agent 上下文压缩失败 …",
      expect.objectContaining({ source: "agent" }),
    );
    expect(log_error).not.toHaveBeenCalled();

    fake_agent_state.summary_failures_remaining = 0;
    fake_agent_state.mode = "success";
    await service.send_message({ text: "下一轮", attachments: [] });
    await wait_for_idle(service);
    expect(
      service.get_snapshot().entries.findLast((entry) => entry.kind === "context_compaction"),
    ).toMatchObject({ id: failed_compaction?.id, status: "success" });
    expect(fake_agent_state.prompts.at(-1)).toBe("下一轮");
  });

  it("同一事件循环的第二条消息异步拒绝", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";

    const first = service.send_message({ text: "第一轮", attachments: [] });
    const second = service.send_message({ text: "第二轮", attachments: [] });

    await expect(second).rejects.toThrow("runtime.busy");
    await expect(first).resolves.toEqual({ revision: expect.any(Number) });
    expect(service.get_snapshot().state).toBe("running");
    expect(service.get_snapshot().entries).toEqual([expect.objectContaining({ text: "第一轮" })]);
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    service.stop();
  });

  it("运行中消息按 FIFO 排队并在出队时采用模型设置", async () => {
    const { service, select_agent_model } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });

    await service.send_message({ text: "第二轮", attachments: [] });
    await service.send_message({ text: "第三轮", attachments: [] });
    expect(service.get_snapshot().inputQueue.items.map((item) => item.text)).toEqual([
      "第二轮",
      "第三轮",
    ]);
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    select_agent_model("next");
    expect(fake_agent_state.model_ids).toEqual(["test-model"]);
    fake_agent_state.mode = "success";
    fake_agent_state.release_pending?.();
    await wait_for_idle(service);

    expect(fake_agent_state.model_ids).toEqual(["test-model", "next-model", "next-model"]);
    expect(fake_agent_state.prompts.slice(-3)).toEqual(["第一轮", "第二轮", "第三轮"]);
    expect(service.get_snapshot().inputQueue.items).toEqual([]);
    expect(
      service
        .get_snapshot()
        .entries.filter((entry) => entry.kind === "user_message")
        .map((entry) => entry.text),
    ).toEqual(["第一轮", "第二轮", "第三轮"]);
  });

  it("入队与修改只验证引用，发送准备失败保留队列和修订前历史", async () => {
    const images = {
      clear: vi.fn(),
      prepare: vi.fn(async () => {
        throw new Error("decode failed");
      }),
    };
    const { service } = await create_service(true, undefined, undefined, undefined, images);
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });
    const file_message = { text: "文件", attachments: [uploaded_file("broken")] };
    await service.send_message(file_message);
    const id = service.get_snapshot().inputQueue.items[0]!.id;
    await service.update_queued_message({ id, message: file_message });
    expect(images.prepare).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(service.get_snapshot().inputQueue.canSendNow).toBe(true));
    await expect(service.send_queued_message({ id })).rejects.toThrow("decode failed");
    expect(service.get_snapshot().inputQueue.items).toMatchObject([{ id, status: "queued" }]);
    fake_agent_state.mode = "success";
    fake_agent_state.release_pending?.();
    await wait_for_idle(service);
    expect(service.get_snapshot().inputQueue).toMatchObject({
      paused: true,
      items: [{ id, status: "queued" }],
    });
    const before = service.get_snapshot().entries;
    expect(before.filter((entry) => entry.kind === "user_message")).toHaveLength(1);
    await expect(
      service.revise_latest_round({ entryId: before[0]!.id, message: file_message }),
    ).rejects.toThrow("decode failed");
    expect(service.get_snapshot().entries).toEqual(before);
  });

  it("自动出队图片准备期间停止，保留已完成轮次与待发送附件并释放运行权", async () => {
    let release!: (image: import("../../shared/agent-image").AgentImage) => void;
    const prepare = vi.fn(
      () =>
        new Promise<import("../../shared/agent-image").AgentImage>((resolve) => {
          release = resolve;
        }),
    );
    const { service, runtime_gate } = await create_service(true, undefined, undefined, undefined, {
      clear: vi.fn(),
      prepare,
    });
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });
    await service.send_message({ text: "图片", attachments: [uploaded_file("pending")] });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    fake_agent_state.mode = "success";
    fake_agent_state.release_pending?.();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    service.stop();
    release({
      data: "ready",
      mimeType: "image/webp",
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
    });
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
    expect(service.get_snapshot().entries[0]).toMatchObject({ text: "第一轮", status: "success" });
    expect(service.get_snapshot().inputQueue).toMatchObject({
      paused: true,
      items: [{ text: "图片", status: "queued" }],
    });
    expect(fake_agent_state.model_call_count).toBe(1);
  });

  it("队列轮次换模失败时记录该轮失败并暂停剩余输入", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    await service.send_message({ text: "第二轮", attachments: [] });
    await service.send_message({ text: "第三轮", attachments: [] });
    fake_agent_state.auth_configured = false;
    fake_agent_state.release_pending?.();
    await wait_for_idle(service);
    expect(service.get_snapshot().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_message", text: "第二轮", status: "error" }),
      ]),
    );
    expect(service.get_snapshot().inputQueue).toMatchObject({
      paused: true,
      items: [{ text: "第三轮" }],
    });
  });

  it("停止会保留并暂停队列", async () => {
    const { service, runtime_gate } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });
    await service.send_message({ text: "第二轮", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());

    service.stop();
    const snapshot = service.get_snapshot();

    expect(snapshot.state).toBe("idle");
    expect(snapshot.inputQueue).toMatchObject({ paused: true, items: [{ text: "第二轮" }] });
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
    expect(service.get_snapshot().inputQueue.canSendNow).toBe(true);
    const task_lease = runtime_gate.begin_runtime("batch_translation");
    await expect(service.continue_session({})).rejects.toThrow("runtime.busy");
    expect(service.get_snapshot().inputQueue).toMatchObject({
      paused: true,
      items: [{ text: "第二轮" }],
    });
    runtime_gate.finish_runtime(task_lease);
    await expect(service.send_message({ text: "不得越过队首", attachments: [] })).rejects.toThrow(
      "request.validation_failed",
    );

    fake_agent_state.mode = "success";
    await service.continue_session({
      message: { text: "第三轮", attachments: [] },
    });
    await wait_for_idle(service);
    expect(fake_agent_state.prompts.slice(-2)).toEqual(["第二轮", "第三轮"]);
    expect(service.get_snapshot().inputQueue.items).toEqual([]);
  });

  it("暂停队列允许空 continue 且不制造公开空 user", async () => {
    const { service, runtime_gate } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });
    await service.send_message({ text: "第二轮", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    service.stop();
    await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());

    fake_agent_state.mode = "success";
    await service.continue_session({});
    await wait_for_idle(service);

    expect(service.get_snapshot().inputQueue.items).toEqual([]);
    expect(service.get_snapshot().entries.filter((entry) => entry.kind === "user_message")).toEqual(
      [
        expect.objectContaining({ text: "第一轮", status: "stopped" }),
        expect.objectContaining({ text: "第二轮", status: "success" }),
      ],
    );
  });

  it("失败轮次 continue 成功后自动消费暂停队列", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "tools_error";
    fake_agent_state.hold_tool_execution = true;
    await service.send_message({ text: "第一轮", attachments: [] });
    await vi.waitFor(() => expect(fake_agent_state.release_tool_execution).not.toBeNull());
    await service.send_message({ text: "第二轮", attachments: [] });
    fake_agent_state.release_tool_execution?.();
    await wait_for_idle(service);
    expect(service.get_snapshot().inputQueue).toMatchObject({
      paused: true,
      items: [{ text: "第二轮" }],
    });

    fake_agent_state.mode = "success";
    await service.continue_session({});
    await wait_for_idle(service);

    expect(service.get_snapshot().inputQueue.items).toEqual([]);
    expect(
      service
        .get_snapshot()
        .entries.filter((entry) => entry.kind === "user_message")
        .map((entry) => entry.text),
    ).toEqual(["第一轮", "第二轮"]);
    expect(fake_agent_state.prompts.slice(-2)).toEqual(["继续", "第二轮"]);
  });

  it("立即发送由 Pi 消费后才从队列提交为 steer 消息", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    await service.send_message({ text: "第一轮", attachments: [] });
    await service.send_message({ text: "插队消息", attachments: [] });
    const queued = service.get_snapshot();
    const item_id = queued.inputQueue.items[0]?.id;
    expect(item_id).toBeDefined();
    await vi.waitFor(() => expect(service.get_snapshot().inputQueue.canSendNow).toBe(true));

    await service.send_queued_message({ id: item_id! });
    expect(service.get_snapshot().inputQueue.items[0]?.status).toBe("sending");
    fake_agent_state.mode = "success";
    fake_agent_state.release_pending?.();
    await wait_for_idle(service);

    expect(service.get_snapshot().inputQueue.items).toEqual([]);
    expect(service.get_snapshot().entries.filter((entry) => entry.kind === "user_message")).toEqual(
      [
        expect.objectContaining({ text: "第一轮", delivery: "round" }),
        expect.objectContaining({ text: "插队消息", delivery: "steer" }),
      ],
    );
  });

  it.each([null, "next"])("批量翻译按保存偏好 %s 直接执行并跟随下一轮主模型", async (model_id) => {
    fake_agent_state.batch_mode = true;
    const run = vi.fn<
      import("../batch-translation/batch-translation-service").BatchTranslationService["run_under_agent"]
    >(async () => ({ status: "done", progress: normalize_batch_translation_progress({}) }));
    const { service, select_agent_model, select_batch_translation_model } = await create_service(
      true,
      undefined,
      undefined,
      { run_under_agent: run },
    );
    select_batch_translation_model(model_id);
    await service.send_message({ text: "执行翻译", attachments: [] });
    await wait_for_idle(service);
    expect(run).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(AbortSignal),
      expect.objectContaining(
        model_id === null
          ? { id: "active", model_id: "test-model", api_key: "secret", thinking: { level: "OFF" } }
          : {
              id: "next",
              model_id: "next-model",
              api_key: "next-secret",
              thinking: { level: "HIGH" },
            },
      ),
      { scope: { kind: "all" }, include_errors: false },
    );
    expect(service.get_snapshot().pendingDecision).toBeNull();
    select_agent_model("next");
    await service.send_message({ text: "继续翻译", attachments: [] });
    await wait_for_idle(service);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.at(-1)?.[2]).toMatchObject({ id: "next" });
  });

  it.each([{ cleanup_failed: false }, { cleanup_failed: true }])(
    "用户停止后同轮暂停，后续用户轮次可继续，$cleanup_failed",
    async ({ cleanup_failed }) => {
      fake_agent_state.batch_mode = true;
      fake_agent_state.batch_retries = 2;
      const progress = {
        start_time: 0,
        time: 0,
        total_line: 2,
        line: 1,
        processed_line: 1,
        error_line: 0,
        total_tokens: 0,
        total_input_tokens: 0,
        total_reasoning_tokens: 0,
        total_output_tokens: 0,
      };
      const run = vi.fn(async () => {
        const result = {
          status: cleanup_failed ? ("error" as const) : ("stopped" as const),
          stop_source: "user" as const,
          progress,
        };
        if (cleanup_failed)
          throw new BatchTranslationCompletionError(result, new Error("cleanup failed"));
        return result;
      });
      const { service, log_error } = await create_service(true, undefined, undefined, {
        run_under_agent: run,
      });
      await service.send_message({ text: "翻译工程", attachments: [] });

      await wait_for_idle(service);
      expect(run).toHaveBeenCalledTimes(1);
      expect(read_tool_output(service, "batch-translation")).toMatchObject({
        status: cleanup_failed ? "error" : "stopped",
        stop_source: "user",
      });
      if (cleanup_failed) {
        expect(log_error).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ error: expect.any(BatchTranslationCompletionError) }),
        );
      }
      await service.send_message({ text: "继续翻译", attachments: [] });

      await wait_for_idle(service);
      expect(run).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["complete", "stop", "reset", "dispose"] as const)(
    "批量工具阻塞真实 SDK 回合并正确处理 %s",
    async (action) => {
      fake_agent_state.batch_mode = true;
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let signal: AbortSignal | undefined;
      let received_lease: import("../runtime-operation-gate").RuntimeLease | undefined;
      const { service, runtime_gate } = await create_service(true, undefined, undefined, {
        run_under_agent: async (lease, parent) => {
          received_lease = lease;
          signal = parent;
          await pending;
          return {
            status: parent.aborted ? "stopped" : "done",
            progress: {
              start_time: 0,
              time: 0,
              line: 2,
              total_line: 2,
              processed_line: 2,
              error_line: 0,
              total_tokens: 0,
              total_input_tokens: 0,
              total_reasoning_tokens: 0,
              total_output_tokens: 0,
            },
          };
        },
      });
      await service.send_message({ text: "翻译当前工程", attachments: [] });

      await vi.waitFor(() => expect(signal).toBeDefined());
      expect(fake_agent_state.model_call_count).toBe(1);
      expect(runtime_gate.get_snapshot().owner).toBe("agent");
      runtime_gate.assert_current_runtime(received_lease!, "agent");
      let closing: Promise<unknown> | undefined;
      if (action !== "complete") {
        closing = Promise.resolve(
          action === "stop"
            ? service.stop()
            : action === "reset"
              ? service.reset()
              : service.dispose(),
        );
        await vi.waitFor(() => expect(signal?.aborted).toBe(true));
        expect(runtime_gate.get_snapshot().owner).toBe("agent");
      }
      finish();
      await closing;
      await vi.waitFor(() => expect(runtime_gate.get_snapshot().owner).toBeNull());
      if (action === "complete") {
        expect(fake_agent_state.model_call_count).toBe(2);
        expect(read_tool_output(service, "batch-translation")).toMatchObject({
          status: "done",
          progress: { line: 2 },
        });
      }
    },
  );

  it("资源未加载时拒绝启动模型回合", async () => {
    const { service } = await create_service(false);

    await expect(service.send_message({ text: "开始", attachments: [] })).rejects.toThrow(
      "runtime.internal_invariant",
    );
  });

  it("普通任务占用运行时期间拒绝 Agent 消息", async () => {
    const { service, runtime_gate } = await create_service();
    const lease = runtime_gate.begin_runtime("batch_translation");

    await expect(service.send_message({ text: "开始", attachments: [] })).rejects.toThrow(
      "runtime.busy",
    );
    runtime_gate.finish_runtime(lease);
  });

  /** 只替换资源、模型与领域协作者，生命周期、门禁和 AgentSession 仍走生产实现。 */
  async function create_service(
    load_resources = true,
    web_search?: AgentWebSearchPort,
    workspace?: AgentWorkspacePort,
    batch_translation?: Pick<
      import("../batch-translation/batch-translation-service").BatchTranslationService,
      "run_under_agent"
    >,
    images: ConstructorParameters<typeof AgentService>[0]["images"] = {
      clear: vi.fn(),
      prepare: async (data) => ({
        data: Buffer.from(data).toString("base64"),
        mimeType: "image/webp",
        width: 1,
        height: 1,
        originalWidth: 1,
        originalHeight: 1,
      }),
    },
  ): Promise<{
    service: AgentService;
    publish: ReturnType<typeof vi.fn>;
    read_items: ReturnType<typeof vi.fn<() => JsonRecord[]>>;
    log_error: ReturnType<typeof vi.fn>;
    log_warning: ReturnType<typeof vi.fn>;
    log_append: ReturnType<typeof vi.fn>;
    select_agent_model: (model_id: "active" | "next") => void;
    set_app_language: (app_language: AppLanguage) => void;
    runtime_gate: RuntimeOperationGate;
    select_batch_translation_model: (model_id: string | null) => void;
    session_state: ProjectSessionState;
  }> {
    const session_state = new ProjectSessionState();
    await session_state.mark_loaded("test.lg");
    const read_items = vi.fn<() => JsonRecord[]>(() => []);
    let agent_model_id: "active" | "next" = "active";
    let batch_model_id: string | null = null;
    let app_language: AppLanguage = "ZH";
    const settings = {
      read_setting: () => {
        return {
          app_language,
          model_selection: {
            translation: "active",
            agent: agent_model_id,
            agent_batch_translation: batch_model_id,
          },
          models: [
            {
              id: "active",
              name: "Test",
              thinking: { level: "OFF" },
              api_format: "OpenAI",
              api_url: "https://example.test/v1",
              api_key: "secret",
              model_id: "test-model",
              threshold: { input_token_limit: 4096, output_token_limit: 1024 },
            },
            {
              id: "next",
              name: "Next",
              thinking: { level: "HIGH" },
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
    const effective_workspace =
      workspace ??
      ({
        uploads: fake_uploads(),
        list_files: () => [],
        initialize: vi.fn(async () => undefined),
        activate_path: vi.fn(async () => ({ status: "cancelled" as const })),
        invalidate_links: vi.fn(),
        reset_workspace: vi.fn(async () => undefined),
        reset_project: vi.fn(async () => undefined),
        run: vi.fn<AgentWorkspacePort["run"]>(async (script, todos) => {
          await wait_for_held_tool();
          if (script === FAKE_TODO_WRITE_SCRIPT)
            return { images: [], execution: workspace_execution(), todos: ["基础扫描"] };
          if (script === FAKE_TODO_READ_SCRIPT) {
            const result = { todos: [...todos] };
            return { images: [], execution: workspace_execution(result), todos: [...todos] };
          }
          if (script === FAKE_TODO_CLEAR_SCRIPT)
            return { images: [], execution: workspace_execution(), todos: [] };
          const result = { items: read_items() };
          return { images: [], execution: workspace_execution(result), todos: [...todos] };
        }),
        apply_workspace: vi.fn(async (request_approval) => {
          await request_approval?.({
            pages: 0,
            items: 1,
            glossary: 0,
            textPreserve: 0,
            preReplacement: 0,
            postReplacement: 0,
            prompts: 0,
          });
          await wait_for_held_tool();
          return { status: "applied" };
        }),
      } satisfies AgentWorkspacePort);

    /** 把单个工具停在执行体内，分别验证普通工具与原子 apply 的 stop 语义。 */
    async function wait_for_held_tool(): Promise<void> {
      if (!fake_agent_state.hold_tool_execution) return;
      await new Promise<void>((resolve) => {
        fake_agent_state.release_tool_execution = () => {
          fake_agent_state.hold_tool_execution = false;
          fake_agent_state.release_tool_execution = null;
          resolve();
        };
      });
    }
    const publish = vi.fn((_topic: string, _payload: JsonRecord) => undefined);
    const log_error = vi.fn();
    const log_warning = vi.fn();
    const log_append = vi.fn();
    const runtime_gate = new RuntimeOperationGate();
    const service = new AgentService({
      catalog: { read_models: read_builtin_pi_models },
      images,
      batchTranslation: batch_translation ?? {
        run_under_agent: async () => ({
          status: "done",
          progress: normalize_batch_translation_progress({}),
        }),
      },
      paths: {
        get_app_root: () => skill_test_fixture.app_root,
        get_agent_builtin_skill_dir: () => skill_test_fixture.skill_root,
        get_agent_user_skill_dir: () => `${skill_test_fixture.app_root}/user-skills`,
        get_agent_system_prompt_path: () =>
          `${skill_test_fixture.app_root}/builtin/agent/system_prompt.md`,
        get_agent_session_seed_path: () =>
          `${skill_test_fixture.app_root}/builtin/agent/session_seed.json`,
      },
      settings,
      userAgent: "LinguaGacha/Test",
      sessionState: session_state,
      runtimeGate: runtime_gate,
      webSearch: web_search,
      workspace: effective_workspace,
      logManager: { append: log_append, error: log_error, warning: log_warning },
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
      log_append,
      select_agent_model: (model_id) => {
        agent_model_id = model_id;
      },
      set_app_language: (next_app_language) => {
        app_language = next_app_language;
      },
      runtime_gate,
      select_batch_translation_model: (id) => {
        batch_model_id = id;
      },
      session_state,
    };
  }
});

/** 先建立可压缩旧历史，再用单个大工具结果跨过下一请求阈值。 */
async function prepare_long_tool_history(
  service: AgentService,
  read_items: ReturnType<typeof vi.fn<() => JsonRecord[]>>,
): Promise<void> {
  read_items.mockReturnValue([
    {
      item_id: 1,
      src: `Alice${"x".repeat(100_000)}`,
      dst: "",
      row_number: 1,
      file_path: "large.json",
      status: "translated",
      retry_count: 0,
    },
  ]);
  fake_agent_state.context_window = TEST_COMPACTION_CONTEXT_WINDOW;
  for (const round of [1, 2, 3]) {
    await service.send_message({
      text: `历史${round.toString()}${"x".repeat(40_000)}`,
      attachments: [],
    });
    await wait_for_idle(service);
  }
}

/** 建立超过固定保留量、但尚未达到默认自动压缩阈值的空闲历史。 */
async function prepare_manual_compaction_history(service: AgentService): Promise<void> {
  for (const round of [1, 2, 3, 4]) {
    await service.send_message({
      text: `第${round.toString()}轮${"x".repeat(40_000)}`,
      attachments: [],
    });
    await wait_for_idle(service);
  }
}

/** 等待公开会话终态，不依赖 SDK 内部 idle 时序。 */
async function wait_for_idle(service: AgentService): Promise<void> {
  await vi.waitFor(() => expect(service.get_snapshot().state).toBe("idle"));
}

/** 从公开时间线读取模型实际收到的工具 JSON，验证跨回合生命周期。 */
function read_tool_output(service: AgentService, id: string): JsonRecord {
  const entry = service
    .get_snapshot()
    .entries.find((candidate) => candidate.kind === "tool_call" && candidate.id === id);
  if (entry?.kind !== "tool_call" || entry.output === null) {
    throw new Error(`缺少工具结果: ${id}`);
  }
  expect(entry.output).toHaveLength(1);
  return JSON.parse(entry.output[0]!) as JsonRecord;
}

/** 事件数量本身是 reset/生命周期只发布一次 seed 的公开契约。 */
function count_published_events(publish: ReturnType<typeof vi.fn>, type: string): number {
  return publish.mock.calls.filter(([, event]) => event["type"] === type).length;
}

/** 集中断言每轮都必须保持的系统指令边界，避免多个用例复制长清单。 */
function expect_agent_system_prompt(prompt: string | undefined): void {
  expect(prompt).toContain(agent_resource_fixture.system_prompt);
  expect(prompt).toContain("<available_skills>");
  expect(prompt).toContain("<name>glossary-audit</name>");
  expect(prompt).toContain("<description>审校术语</description>");
  expect(prompt).not.toContain("Review glossary");
  expect(prompt).toContain("<name>internal-guidance</name>");
  expect(prompt).not.toContain("<location>");
  expect((prompt ?? "").indexOf("<name>glossary-audit</name>")).toBeLessThan(
    (prompt ?? "").indexOf("<name>internal-guidance</name>"),
  );
  expect(prompt).not.toContain("<name>corpus-search</name>");
  expect(prompt).not.toContain("<visible>");
  expect(prompt).not.toContain(skill_test_fixture.fixture_contents.glossary_audit);
  expect(prompt?.match(/<cwd>/gu)).toHaveLength(1);
  const working_directory = prompt?.match(/<cwd>\s*([\s\S]*?)\s*<\/cwd>/u)?.[1];
  expect(working_directory?.replaceAll("\\", "/")).toBe(skill_test_fixture.app_root);
}

/** 服务编排测试通过字节身份隔离编解码，磁盘发布由上传存储测试验证。 */
function fake_uploads(): AgentWorkspacePort["uploads"] {
  return {
    get: (id) => uploaded_file(id),
    read_image: (id) => Buffer.from(id),
    upload: vi.fn(),
    open: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(async () => undefined),
  };
}
