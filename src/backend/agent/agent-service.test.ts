import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTool } from "@earendil-works/pi-agent-core";
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

const fake_agent_state = vi.hoisted(() => ({
  mode: "complete" as
    | "complete"
    | "write"
    | "failure"
    | "pending"
    | "thinking"
    | "tool_only"
    | "tools",
  abort_count: 0,
  id: 0,
  system_prompts: [] as string[],
  prompts: [] as string[],
  model_ids: [] as string[],
  agent_instances: 0,
  tools: [] as AgentTool[],
  release_pending: null as (() => void) | null,
  hold_idle: false,
  external_change_during_write: false,
  release_idle: null as (() => void) | null,
  emit_late: null as ((event: Record<string, unknown>) => void) | null,
}));

vi.mock("./agent-skills", () => ({ load_agent_skills: skill_loader }));
vi.mock("./agent-system-prompt", () => ({
  load_agent_system_prompt: system_prompt_loader,
}));

vi.mock("@earendil-works/pi-agent-core", async (import_original) => {
  const actual = await import_original<typeof import("@earendil-works/pi-agent-core")>();

  /** 只替换远程模型运行时，同时按真实 Pi 事件顺序驱动 AgentService 的公开观察面。 */
  class FakeAgent {
    public readonly state: Record<string, unknown> = { isStreaming: false };
    public streamFunction: unknown;
    private listener: ((event: Record<string, unknown>) => void) | null = null;

    public constructor(private readonly options: Record<string, unknown>) {
      fake_agent_state.agent_instances += 1;
      Object.assign(this.state, options["initialState"]);
      this.streamFunction = options["streamFn"];
      fake_agent_state.tools = this.state["tools"] as AgentTool[];
    }

    public subscribe(listener: (event: Record<string, unknown>) => void): () => void {
      this.listener = listener;
      fake_agent_state.emit_late = listener;
      return () => {
        this.listener = null;
      };
    }

    public async prompt(prompt: string): Promise<void> {
      this.state["isStreaming"] = true;
      fake_agent_state.system_prompts.push(String(this.state["systemPrompt"] ?? ""));
      fake_agent_state.prompts.push(prompt);
      fake_agent_state.model_ids.push(
        String((this.state["model"] as Record<string, unknown> | undefined)?.["id"] ?? ""),
      );
      try {
        if (fake_agent_state.mode === "pending") {
          await new Promise<void>((resolve) => {
            fake_agent_state.release_pending = resolve;
          });
          return;
        }
        if (fake_agent_state.mode === "failure") throw new Error("request failed");
        if (fake_agent_state.mode === "write") {
          const tools = this.state["tools"] as AgentTool[];
          const write_tool = tools.find((tool) => tool.name === "update_quality_rules");
          if (write_tool === undefined) throw new Error("缺少 update_quality_rules");
          await write_tool.execute("write-1", {
            rule_type: "glossary",
            meta: { enabled: false },
            expected_section_revisions: { quality: 3 },
          });
        } else if (fake_agent_state.mode === "tools") {
          this.emit_tool_round();
        } else if (fake_agent_state.mode === "thinking") {
          this.emit_thinking_assistant();
        } else if (fake_agent_state.mode === "tool_only") {
          this.emit_tool_only_round();
        } else {
          this.emit_assistant("已完成");
        }
      } finally {
        this.state["isStreaming"] = false;
      }
    }

    public abort(): void {
      fake_agent_state.abort_count += 1;
      fake_agent_state.release_pending?.();
      fake_agent_state.release_pending = null;
    }

    public async waitForIdle(): Promise<void> {
      if (!fake_agent_state.hold_idle) return;
      await new Promise<void>((resolve) => {
        fake_agent_state.release_idle = resolve;
      });
    }

    private emit_assistant(text: string): void {
      const message = this.create_assistant_message([{ type: "text", text }]);
      this.listener?.({ type: "message_start", message });
      this.listener?.({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "text_delta", delta: text, partial: message },
      });
      this.listener?.({ type: "message_end", message });
    }

    /** 驱动 thinking 增量、相邻块合并、脱敏块过滤和最终正文顺序。 */
    private emit_thinking_assistant(): void {
      const started = this.create_assistant_message([]);
      const thinking = this.create_assistant_message([
        { type: "thinking", thinking: "检查术语\n", thinkingSignature: "private-visible" },
      ]);
      const complete = this.create_assistant_message([
        { type: "thinking", thinking: "检查术语\n", thinkingSignature: "private-visible" },
        { type: "thinking", thinking: "逐项核对" },
        {
          type: "thinking",
          thinking: "",
          thinkingSignature: "private-redacted",
          redacted: true,
        },
        { type: "text", text: "已完成" },
      ]);
      this.listener?.({ type: "message_start", message: started });
      this.listener?.({
        type: "message_update",
        message: thinking,
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "检查术语\n",
          partial: thinking,
        },
      });
      this.listener?.({
        type: "message_update",
        message: complete,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 3,
          delta: "已完成",
          partial: complete,
        },
      });
      this.listener?.({ type: "message_end", message: complete });
    }

    private create_assistant_message(content: JsonRecord[]): JsonRecord {
      return {
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "openai",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
    }

    private emit_tool_round(): void {
      this.emit_assistant("准备查询");
      this.listener?.({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "query_project_items",
        args: { patterns: ["Alice", "Bob"] },
      });
      this.listener?.({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "query_project_items",
        result: {
          content: [{ type: "text", text: '{"results":[{"total_matches":2}]}' }],
          details: { results: [{ total_matches: 2 }, { total_matches: 5 }] },
        },
        isError: false,
      });
      this.listener?.({
        type: "tool_execution_start",
        toolCallId: "tool-2",
        toolName: "read_skill",
        args: { path: "E:/skills/glossary-audit/references/audit-standard.md" },
      });
      this.listener?.({
        type: "tool_execution_end",
        toolCallId: "tool-2",
        toolName: "read_skill",
        result: {
          content: [{ type: "text", text: '{"content":"完整正文"}' }],
          details: {
            skill: "glossary-audit",
            path: "E:/skills/glossary-audit/references/audit-standard.md",
            content: "完整正文",
          },
        },
        isError: false,
      });
      this.emit_assistant("查询完成");
    }

    /** 驱动只有 toolCall 的 assistant 帧，验证公开时间线不会产生空消息。 */
    private emit_tool_only_round(): void {
      const message = this.create_assistant_message([
        {
          type: "toolCall",
          id: "tool-only",
          name: "query_project_items",
          arguments: { patterns: ["Alice"] },
        },
      ]);
      this.listener?.({ type: "message_start", message });
      this.listener?.({ type: "message_end", message });
      this.listener?.({
        type: "tool_execution_start",
        toolCallId: "tool-only",
        toolName: "query_project_items",
        args: { patterns: ["Alice"] },
      });
      this.listener?.({
        type: "tool_execution_end",
        toolCallId: "tool-only",
        toolName: "query_project_items",
        result: { content: [{ type: "text", text: '{"results":[]}' }], details: {} },
        isError: false,
      });
    }
  }

  return {
    ...actual,
    Agent: FakeAgent,
    uuidv7: () => `message-${(fake_agent_state.id += 1).toString()}`,
  };
});

import { AGENT_PROOFREADING_UPDATE_SOURCE } from "./agent-item-tools";
import { AGENT_QUALITY_RULE_UPDATE_SOURCE } from "./agent-quality-tools";
import { AgentService } from "./agent-service";

describe("AgentService", () => {
  const services: AgentService[] = [];

  beforeEach(() => {
    fake_agent_state.mode = "complete";
    fake_agent_state.abort_count = 0;
    fake_agent_state.id = 0;
    fake_agent_state.system_prompts = [];
    fake_agent_state.prompts = [];
    fake_agent_state.model_ids = [];
    fake_agent_state.agent_instances = 0;
    fake_agent_state.tools = [];
    fake_agent_state.release_pending = null;
    fake_agent_state.hold_idle = false;
    fake_agent_state.external_change_during_write = false;
    fake_agent_state.release_idle = null;
    fake_agent_state.emit_late = null;
    skill_loader.mockClear();
    system_prompt_loader.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fake_agent_state.hold_idle = false;
    fake_agent_state.release_idle?.();
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
        id: "message-1",
        parts: [{ kind: "text", text: "查询" }],
        createdAt: expect.any(Number),
        endedAt: expect.any(Number),
      },
      {
        kind: "assistant_message",
        id: "message-2",
        parts: [{ kind: "text", text: "准备查询" }],
        createdAt: expect.any(Number),
        complete: true,
      },
      {
        kind: "tool_call",
        id: "tool-1",
        toolName: "query_project_items",
        status: "success",
        output: '{"results":[{"total_matches":2}]}',
        createdAt: expect.any(Number),
      },
      {
        kind: "tool_call",
        id: "tool-2",
        toolName: "read_skill",
        status: "success",
        output: '{"content":"完整正文"}',
        createdAt: expect.any(Number),
      },
      {
        kind: "assistant_message",
        id: "message-3",
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

  it("请求失败发布 typed event 并结束回合，不在后端拼用户文案", async () => {
    const { service, publish, log_error } = await create_service();
    fake_agent_state.mode = "failure";

    service.send_message({ parts: [{ kind: "text", text: "开始" }] });
    await wait_for_complete(service);

    expect(publish).toHaveBeenCalledWith("agent.session_event", { type: "request_failed" });
    expect(log_error).toHaveBeenCalledWith(
      "Agent 模型回合失败",
      expect.objectContaining({ source: "agent", error: expect.any(Error) }),
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
    expect(fake_agent_state.tools.map((tool) => tool.name)).toEqual([
      "query_quality_rules",
      "update_quality_rules",
      "query_project_items",
      "update_project_translations",
      "read_skill",
    ]);
    expect(service.get_snapshot().entries).toHaveLength(1);

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

  it("停止会中断当前回合并回到 idle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    service.send_message({ parts: [{ kind: "text", text: "开始" }] });

    vi.setSystemTime(13_500);
    expect(service.stop()).toMatchObject({
      state: "idle",
      entries: [{ kind: "user_message", createdAt: 1_000, endedAt: 13_500 }],
    });
    expect(fake_agent_state.abort_count).toBe(1);
  });

  it("运行中重置立即隔离旧会话，并在旧回合退出后创建全新 Agent", async () => {
    const { service, publish } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    service.send_message({
      parts: [
        { kind: "skill", name: "corpus-search" },
        { kind: "text", text: "旧任务" },
      ],
    });
    const old_skill_tool = fake_agent_state.tools.find(
      (candidate) => candidate.name === "read_skill",
    );
    if (old_skill_tool === undefined) throw new Error("缺少 read_skill");

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
    fake_agent_state.emit_late?.({
      type: "tool_execution_start",
      toolCallId: "late-tool",
      toolName: "query_project_items",
      args: {},
    });
    expect(service.get_snapshot().entries).toEqual([]);
    await expect(
      old_skill_tool.execute("manual-after-reset", {
        path: "E:/skills/corpus-search/SKILL.md",
      }),
    ).rejects.toThrow("技能文件不存在或当前会话不可读取");

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_idle?.();
    await expect(resetting).resolves.toMatchObject({ state: "idle", entries: [] });
    fake_agent_state.mode = "complete";
    service.send_message({ parts: [{ kind: "text", text: "新任务" }] });
    await wait_for_complete(service);

    expect(fake_agent_state.agent_instances).toBe(2);
    expect(service.get_snapshot().entries.filter((entry) => entry.kind === "user_message")).toEqual(
      [expect.objectContaining({ parts: [{ kind: "text", text: "新任务" }] })],
    );
    const new_skill_tool = fake_agent_state.tools.find(
      (candidate) => candidate.name === "read_skill",
    );
    if (new_skill_tool === undefined) throw new Error("缺少 read_skill");
    await expect(
      new_skill_tool.execute("auto-after-reset", {
        path: "E:/skills/glossary-audit/SKILL.md",
      }),
    ).resolves.toMatchObject({ details: { content: "执行术语审校。" } });
  });

  it("dispose 等待已经脱离 runtime 的重置收尾", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    fake_agent_state.hold_idle = true;
    service.send_message({ parts: [{ kind: "text", text: "旧任务" }] });
    const resetting = service.reset();

    let disposed = false;
    const disposing = service.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    fake_agent_state.hold_idle = false;
    fake_agent_state.release_idle?.();
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

  it("空闲回合之间重绑定 Agent 模型并复用同一运行时和历史", async () => {
    const { service, select_agent_model } = await create_service();

    service.send_message({ parts: [{ kind: "text", text: "第一轮" }] });
    await wait_for_complete(service);
    select_agent_model("next");
    service.send_message({ parts: [{ kind: "text", text: "第二轮" }] });
    await wait_for_complete(service);

    expect(fake_agent_state.agent_instances).toBe(1);
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
    service.stop();
  });

  it("read_skill 始终读取自动 skill，并仅在显式引用后读取 manual-only skill", async () => {
    const { service } = await create_service();

    service.send_message({ parts: [{ kind: "text", text: "普通对话" }] });
    await wait_for_complete(service);
    const skill_tool = fake_agent_state.tools.find((candidate) => candidate.name === "read_skill");
    if (skill_tool === undefined) throw new Error("缺少 read_skill");
    await expect(
      skill_tool.execute("auto-root", {
        path: "E:/skills/glossary-audit/SKILL.md",
      }),
    ).resolves.toMatchObject({ details: { content: "执行术语审校。" } });
    await expect(
      skill_tool.execute("auto-reference", {
        path: "E:/skills/glossary-audit/references/audit-standard.md",
      }),
    ).resolves.toMatchObject({ details: { content: "# 审校标准\n\n完整正文。" } });
    await expect(
      skill_tool.execute("manual-before-invocation", {
        path: "E:/skills/corpus-search/SKILL.md",
      }),
    ).rejects.toThrow("技能文件不存在或当前会话不可读取");

    service.send_message({ parts: [{ kind: "skill", name: "corpus-search" }] });
    await wait_for_complete(service);
    await expect(
      skill_tool.execute("manual-after-invocation", {
        path: "E:/skills/corpus-search/SKILL.md",
      }),
    ).resolves.toMatchObject({
      details: { content: "执行语料检索。" },
    });
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
