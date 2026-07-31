import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type Context,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import type { JsonRecord } from "../../domain/json";
import type { ProjectChangeEvent, ProjectWriteResult } from "../../shared/project-event";
import { ProjectSessionState } from "../project/project-session-state";

const skill_loader = vi.hoisted(() =>
  vi.fn(async () => [
    {
      name: "glossary-audit",
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
      name: "corpus-search",
      description: "检索语料",
      content: "执行语料检索。",
      filePath: "E:/skills/corpus-search/SKILL.md",
      disableModelInvocation: true,
      references: [],
    },
  ]),
);
const system_prompt_loader = vi.hoisted(() => vi.fn(() => "基础系统指令。"));
const agent_model_resolver = vi.hoisted(() => vi.fn());

const fake_agent_state = vi.hoisted(() => ({
  mode: "complete" as
    | "complete"
    | "write"
    | "failure"
    | "pending"
    | "read_skill"
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
  external_change_during_write: false,
}));

vi.mock("./agent-skills", () => ({ load_agent_skills: skill_loader }));
vi.mock("./agent-system-prompt", () => ({
  load_agent_system_prompt: system_prompt_loader,
}));
vi.mock("./agent-model", () => ({ resolve_agent_model: agent_model_resolver }));

import { AGENT_PROOFREADING_UPDATE_SOURCE } from "./agent-item-tools";
import { AGENT_QUALITY_RULE_UPDATE_SOURCE } from "./agent-quality-tools";
import { AgentService } from "./agent-service";

/** 测试只替换远程流边界，Agent 的事件、工具执行、abort 与收尾均使用真实实现。 */
const fake_agent_stream: StreamFn = (model, context, options) => {
  fake_agent_state.system_prompts.push(context.systemPrompt ?? "");
  fake_agent_state.prompts.push(read_last_user_text(context));
  fake_agent_state.model_ids.push(model.id);
  fake_agent_state.tool_names.push(context.tools?.map((tool) => tool.name) ?? []);
  const faux = createFauxCore({
    api: model.api,
    provider: model.provider,
    tokenSize: { min: 10_000, max: 10_000 },
  });
  faux.setResponses([create_fake_response(context)]);
  return faux.streamSimple(model, context, options);
};

/** 根据测试配置选择模型身份，远程行为统一交给同一个可控流边界。 */
function resolve_fake_agent_model(config: JsonRecord) {
  const selection = config["model_selection"];
  const selected =
    typeof selection === "object" && selection !== null && !Array.isArray(selection)
      ? Reflect.get(selection, "agent")
      : undefined;
  const model_id = selected === "next" ? "next-model" : "test-model";
  return {
    model: {
      id: model_id,
      name: model_id,
      api: "faux",
      provider: "faux",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
    },
    thinkingLevel: "off" as const,
    stream: fake_agent_stream,
  };
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
  if (fake_agent_state.mode === "failure") {
    return fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "request failed",
    });
  }
  if (fake_agent_state.mode === "thinking") {
    return fauxAssistantMessage([
      {
        type: "thinking",
        thinking: "检查术语\n",
        thinkingSignature: "private-visible",
      },
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
      fauxToolCall(
        "query_project_items",
        { mode: "search", patterns: ["Alice"] },
        { id: "tool-only" },
      ),
      { stopReason: "toolUse" },
    );
  }
  if (fake_agent_state.mode === "tools") {
    return fauxAssistantMessage(
      [
        fauxText("准备查询"),
        fauxToolCall(
          "query_project_items",
          { mode: "search", patterns: ["Alice", "Bob"] },
          { id: "tool-1" },
        ),
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
    fake_agent_state.mode = "complete";
    fake_agent_state.abort_count = 0;
    fake_agent_state.system_prompts = [];
    fake_agent_state.prompts = [];
    fake_agent_state.model_ids = [];
    fake_agent_state.tool_names = [];
    fake_agent_state.release_pending = null;
    fake_agent_state.hold_idle = false;
    fake_agent_state.external_change_during_write = false;
    agent_model_resolver.mockReset();
    agent_model_resolver.mockImplementation(resolve_fake_agent_model);
    skill_loader.mockClear();
    system_prompt_loader.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fake_agent_state.hold_idle = false;
    fake_agent_state.release_pending?.();
    await Promise.all(services.splice(0).map(async (service) => await service.dispose()));
  });

  it("快照下发启动期 skill 清单，旧协议、未知和重复 skill 均在变更状态前拒绝", async () => {
    const fixture = await create_service();

    expect(fixture.service.get_snapshot().skills).toEqual([
      { name: "glossary-audit", description: "审校术语" },
      { name: "corpus-search", description: "检索语料" },
    ]);
    expect(() => fixture.service.send_message({ text: "旧协议" })).toThrow(
      "request.validation_failed",
    );
    expect(() =>
      fixture.service.send_message({ parts: [{ kind: "skill", name: "missing" }] }),
    ).toThrow("request.validation_failed");
    expect(() =>
      fixture.service.send_message({
        parts: [
          { kind: "skill", name: "glossary-audit" },
          { kind: "skill", name: "glossary-audit" },
        ],
      }),
    ).toThrow("request.validation_failed");
    expect(fixture.service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
  });

  it("按引用顺序展开多个 skill，并把混排可见文本追加到模型用户消息", async () => {
    const fixture = await create_service();

    fixture.service.send_message({
      parts: [
        { kind: "text", text: "先用 " },
        { kind: "skill", name: "corpus-search" },
        { kind: "text", text: "，再用 " },
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "。" },
      ],
    });
    await wait_for_complete(fixture.service);
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

    fixture.service.send_message({ parts: [{ kind: "skill", name: "glossary-audit" }] });
    await wait_for_complete(fixture.service);

    expect(fake_agent_state.prompts.at(-1)).toMatch(/^<skill name="glossary-audit"/u);
    expect(fake_agent_state.prompts.at(-1)).not.toContain("@glossary-audit");
  });

  it("模型回合只经历 running 到 complete", async () => {
    const { service, publish } = await create_service();

    service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    expect(service.get_snapshot().state).toBe("running");
    expect(service.get_snapshot().entries[0]).toMatchObject({
      kind: "user_message",
      endedAt: null,
    });
    await wait_for_complete(service);

    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(service.get_snapshot()).toMatchObject({
      state: "complete",
      entries: [
        {
          kind: "user_message",
          parts: [{ kind: "text", text: "开始" }],
          endedAt: expect.any(Number),
        },
        {
          kind: "assistant_message",
          parts: [{ kind: "text", text: "已完成" }],
          complete: true,
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
    const complete_index = publish.mock.calls.findIndex(
      ([, event]) => event["type"] === "session_state" && event["state"] === "complete",
    );
    expect(round_end_index).toBeGreaterThan(-1);
    expect(complete_index).toBeGreaterThan(round_end_index);
  });

  it("按上游顺序流式公开思考与正文，并隔离脱敏内容和签名", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "thinking";

    service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await wait_for_complete(service);
    const snapshot = service.get_snapshot();

    expect(snapshot.entries.at(-1)).toMatchObject({
      kind: "assistant_message",
      parts: [
        { kind: "thinking", text: "检查术语\n逐项核对" },
        { kind: "text", text: "已完成" },
      ],
      complete: true,
    });
    expect(publish).toHaveBeenCalledWith(
      "agent.session_event",
      expect.objectContaining({
        type: "entry_upsert",
        entry: expect.objectContaining({
          kind: "assistant_message",
          parts: [{ kind: "thinking", text: "检查术语\n" }],
          complete: false,
        }),
      }),
    );
    expect(JSON.stringify(snapshot)).not.toContain("private-visible");
    expect(JSON.stringify(snapshot)).not.toContain("private-redacted");
  });

  it("纯工具调用消息不产生空 assistant 条目", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "tool_only";

    service.send_message({ parts: [{ kind: "text", text: "查询" }] });
    await wait_for_complete(service);

    expect(service.get_snapshot().entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "tool_call",
    ]);
  });

  it("模型回合按 user、assistant、tool_call、assistant 的真实时序追加条目", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "tools";

    service.send_message({ parts: [{ kind: "text", text: "查询" }] });
    await wait_for_complete(service);
    const snapshot = service.get_snapshot();

    expect(publish).toHaveBeenCalledWith(
      "agent.session_event",
      expect.objectContaining({
        type: "entry_upsert",
        entry: expect.objectContaining({
          kind: "tool_call",
          id: "tool-1",
          status: "running",
          toolName: "query_project_items",
          output: null,
        }),
      }),
    );
    expect(snapshot.entries).toEqual([
      {
        kind: "user_message",
        id: expect.any(String),
        parts: [{ kind: "text", text: "查询" }],
        createdAt: expect.any(Number),
        endedAt: expect.any(Number),
      },
      {
        kind: "assistant_message",
        id: expect.any(String),
        parts: [{ kind: "text", text: "准备查询" }],
        createdAt: expect.any(Number),
        complete: true,
      },
      {
        kind: "tool_call",
        id: "tool-1",
        toolName: "query_project_items",
        status: "success",
        output: expect.stringContaining('"results"'),
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
        createdAt: expect.any(Number),
        complete: true,
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
  });

  it("真实 Agent 将流终态错误发布为 typed event，并让 prompt 正常结束", async () => {
    const { service, publish, log_error } = await create_service();
    fake_agent_state.mode = "failure";

    service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await wait_for_complete(service);

    expect(publish).toHaveBeenCalledWith("agent.session_event", { type: "request_failed" });
    expect(log_error).toHaveBeenCalledWith(
      "Agent 模型回合失败",
      expect.objectContaining({
        source: "agent",
        error: expect.objectContaining({ message: "request failed" }),
      }),
    );
    expect(service.get_snapshot()).toMatchObject({
      state: "complete",
      entries: [
        {
          kind: "user_message",
          parts: [{ kind: "text", text: "开始" }],
          endedAt: expect.any(Number),
        },
      ],
    });
  });

  it("自身工程写入只推进 binding，外部相关变更仍清空会话", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "write";

    service.send_message({
      parts: [
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "写入" },
      ],
    });
    await wait_for_complete(service);
    expect(fake_agent_state.tool_names.at(-1)).toEqual([
      "query_quality_rules",
      "update_quality_rules",
      "query_project_items",
      "update_project_translations",
      "read_skill",
    ]);
    expect(service.get_snapshot().entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "tool_call",
    ]);

    service.handle_project_change(project_change(5));
    expect(service.get_snapshot()).toEqual({
      state: "idle",
      entries: [],
      skills: [
        { name: "glossary-audit", description: "审校术语" },
        { name: "corpus-search", description: "检索语料" },
      ],
    });
  });

  it("Agent 写入尚未提交时遇到外部变更也会清空旧会话", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "write";
    fake_agent_state.external_change_during_write = true;

    service.send_message({ parts: [{ kind: "text", text: "写入" }] });

    await vi.waitFor(() => {
      expect(service.get_snapshot()).toMatchObject({ state: "idle", entries: [] });
    });
  });

  it("外部 items 与 proofreading 变化重置会话，无关 section 不重置", async () => {
    for (const section of ["items", "proofreading"] as const) {
      const { service } = await create_service();
      service.send_message({ parts: [{ kind: "text", text: section }] });
      await wait_for_complete(service);

      service.handle_project_change({
        ...project_change(4),
        eventId: `${section}-unrelated`,
        updatedSections: ["analysis"],
        sectionRevisions: { analysis: 4 },
      });
      expect(service.get_snapshot().entries).not.toHaveLength(0);

      service.handle_project_change({
        ...project_change(4),
        eventId: `${section}-external`,
        updatedSections: [section],
        sectionRevisions: { [section]: 4 },
      });
      expect(service.get_snapshot().entries).toHaveLength(0);
    }
  });

  it("停止会中断当前回合并回到 idle，主动 abort 不上报请求失败", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { service, publish, log_error } = await create_service();
    fake_agent_state.mode = "pending";
    service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(13_500);
    expect(service.stop()).toMatchObject({
      state: "idle",
      entries: [{ kind: "user_message", createdAt: 1_000, endedAt: 13_500 }],
    });
    expect(fake_agent_state.abort_count).toBe(1);
    await service.dispose();
    expect(publish).not.toHaveBeenCalledWith("agent.session_event", {
      type: "request_failed",
    });
    expect(log_error).not.toHaveBeenCalled();
  });

  it("运行中重置立即隔离旧会话，并在旧回合退出后创建全新上下文", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    service.send_message({
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
      skills: [
        { name: "glossary-audit", description: "审校术语" },
        { name: "corpus-search", description: "检索语料" },
      ],
    });
    expect(publish).toHaveBeenLastCalledWith("agent.session_event", {
      type: "snapshot_seed",
      snapshot: service.get_snapshot(),
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    let resetting_error: unknown;
    try {
      service.send_message({ parts: [{ kind: "text", text: "过早的新任务" }] });
    } catch (error) {
      resetting_error = error;
    }
    expect(resetting_error).toMatchObject({
      code: "request.validation_failed",
      diagnostic_context: { reason: "agent_session_resetting" },
    });
    expect(service.get_snapshot().entries).toEqual([]);

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_pending?.();
    await expect(resetting).resolves.toMatchObject({ state: "idle", entries: [] });
    fake_agent_state.mode = "complete";
    service.send_message({ parts: [{ kind: "text", text: "新任务" }] });
    await wait_for_complete(service);

    expect(service.get_snapshot().entries.filter((entry) => entry.kind === "user_message")).toEqual(
      [expect.objectContaining({ parts: [{ kind: "text", text: "新任务" }] })],
    );
  });

  it("dispose 等待已经脱离 runtime 的重置收尾", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    service.send_message({ parts: [{ kind: "text", text: "旧任务" }] });
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

    service.send_message({
      parts: [
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "审校" },
      ],
    });
    await wait_for_complete(service);
    service.send_message({ parts: [{ kind: "text", text: "普通对话" }] });
    await wait_for_complete(service);

    expect(fake_agent_state.system_prompts.at(-1)).toBe(fake_agent_state.system_prompts.at(-2));
    expect_agent_system_prompt(fake_agent_state.system_prompts.at(-1));
    expect(fake_agent_state.prompts.at(-2)).toContain("执行术语审校。");
    expect(fake_agent_state.prompts.at(-1)).toBe("普通对话");
  });

  it("空闲回合之间重绑定 Agent 模型并保留历史", async () => {
    const { service, select_agent_model } = await create_service();

    service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    await wait_for_complete(service);
    select_agent_model("next");
    service.send_message({ parts: [{ kind: "text", text: "第二轮" }] });
    await wait_for_complete(service);

    expect(fake_agent_state.model_ids).toEqual(["test-model", "next-model"]);
    expect(
      service.get_snapshot().entries.filter((entry) => entry.kind === "user_message"),
    ).toHaveLength(2);
  });

  it("运行中重复消息在读取新模型前被拒绝", async () => {
    const { service, read_setting_count } = await create_service();
    fake_agent_state.mode = "pending";
    service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });

    expect(() => service.send_message({ parts: [{ kind: "text", text: "第二轮" }] })).toThrow(
      "request.validation_failed",
    );
    expect(read_setting_count()).toBe(1);
    await vi.waitFor(() => expect(fake_agent_state.release_pending).not.toBeNull());
    service.stop();
  });

  it("read_skill 始终读取自动 skill，并仅在显式引用后读取 manual-only skill", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "read_skill";

    service.send_message({ parts: [{ kind: "text", text: "普通对话" }] });
    await wait_for_complete(service);
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

    service.send_message({ parts: [{ kind: "skill", name: "corpus-search" }] });
    await wait_for_complete(service);
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

    expect(() => service.send_message({ parts: [{ kind: "text", text: "开始" }] })).toThrow(
      "runtime.internal_invariant",
    );
  });

  async function create_service(load_resources = true): Promise<{
    service: AgentService;
    publish: ReturnType<typeof vi.fn>;
    log_error: ReturnType<typeof vi.fn>;
    select_agent_model: (model_id: "active" | "next") => void;
    read_setting_count: () => number;
  }> {
    const session_state = new ProjectSessionState();
    await session_state.mark_loaded("test.lg");
    let revision = 3;
    let items_revision = 0;
    let proofreading_revision = 0;
    let service!: AgentService;
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
      items: { readItems: () => [] },
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
      update: async (
        _request: JsonRecord,
        source = AGENT_QUALITY_RULE_UPDATE_SOURCE,
      ): Promise<ProjectWriteResult> => {
        if (fake_agent_state.external_change_during_write) {
          revision += 1;
          service.handle_project_change(project_change(revision));
        }
        revision += 1;
        service.handle_project_change({ ...project_change(revision), source });
        return { accepted: true, changes: [] };
      },
    };
    const proofreading = {
      update_items: async (
        _request: JsonRecord,
        source = AGENT_PROOFREADING_UPDATE_SOURCE,
      ): Promise<ProjectWriteResult> => {
        items_revision += 1;
        proofreading_revision += 1;
        service.handle_project_change({
          ...project_change(items_revision),
          source,
          sectionRevisions: {
            items: items_revision,
            proofreading: proofreading_revision,
          },
          updatedSections: ["items", "proofreading"],
        });
        return { accepted: true, changes: [] };
      },
    };
    const publish = vi.fn((_topic: string, _payload: JsonRecord) => undefined);
    const log_error = vi.fn();
    service = new AgentService({
      paths: {
        get_app_root: () => "E:/Project/LinguaGacha",
        get_agent_builtin_skill_dir: () => "E:/Project/LinguaGacha/resource/agent/skill",
        get_agent_user_skill_dir: () => "E:/Project/LinguaGacha/userdata/agent/skill",
        get_agent_system_prompt_path: () =>
          "E:/Project/LinguaGacha/resource/agent/system_prompt.md",
      },
      settings,
      userAgent: "LinguaGacha/Test",
      sessionState: session_state,
      cache,
      qualityRules: quality_rules,
      proofreading,
      logManager: { error: log_error, warning: vi.fn() },
      publish,
    });
    if (load_resources) await service.load_resources();
    services.push(service);
    return {
      service,
      publish,
      log_error,
      select_agent_model: (model_id) => {
        agent_model_id = model_id;
      },
      read_setting_count: () => setting_read_count,
    };
  }
});

function project_change(revision: number): ProjectChangeEvent {
  return {
    type: "project.changed" as const,
    eventId: `quality-${revision.toString()}`,
    source: "quality_rule_update",
    projectPath: "test.lg",
    projectRevision: revision,
    sectionRevisions: { quality: revision },
    updatedSections: ["quality"],
  };
}

async function wait_for_complete(service: AgentService): Promise<void> {
  await vi.waitFor(() => expect(service.get_snapshot().state).toBe("complete"));
}

function expect_agent_system_prompt(prompt: string | undefined): void {
  expect(prompt).toContain("基础系统指令。");
  expect(prompt).toContain("<available_skills>");
  expect(prompt).toContain("<name>glossary-audit</name>");
  expect(prompt).toContain("<description>审校术语</description>");
  expect(prompt).toContain("<location>E:/skills/glossary-audit/SKILL.md</location>");
  expect(prompt).not.toContain("<name>corpus-search</name>");
  expect(prompt).not.toContain("执行术语审校。");
  expect(prompt).not.toContain("完整正文。");
}
