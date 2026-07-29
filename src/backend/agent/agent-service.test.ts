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
      essentials: "执行术语审校。",
      reference_index: "## 参考资源\n- audit-standard.md: 审校标准",
      references: [
        {
          file_name: "audit-standard.md",
          summary: "审校标准",
          content: "# 审校标准\n\n完整正文。",
        },
      ],
    },
  ]),
);

const fake_agent_state = vi.hoisted(() => ({
  mode: "complete" as "complete" | "write" | "failure" | "pending",
  abort_count: 0,
  id: 0,
  system_prompts: [] as string[],
  release_pending: null as (() => void) | null,
}));

vi.mock("./agent-skills", () => ({ load_agent_skills: skill_loader }));

vi.mock("@earendil-works/pi-agent-core", () => {
  class FakeAgent {
    public readonly state: Record<string, unknown> = { isStreaming: false };
    private listener: ((event: Record<string, unknown>) => void) | null = null;

    public constructor(private readonly options: Record<string, unknown>) {
      Object.assign(this.state, options["initialState"]);
    }

    public subscribe(listener: (event: Record<string, unknown>) => void): () => void {
      this.listener = listener;
      return () => {
        this.listener = null;
      };
    }

    public async prompt(): Promise<void> {
      this.state["isStreaming"] = true;
      fake_agent_state.system_prompts.push(String(this.state["systemPrompt"] ?? ""));
      if (fake_agent_state.mode === "pending") {
        await new Promise<void>((resolve) => {
          fake_agent_state.release_pending = resolve;
        });
        return;
      }
      if (fake_agent_state.mode === "failure") {
        this.state["isStreaming"] = false;
        throw new Error("request failed");
      }
      if (fake_agent_state.mode === "write") {
        const tools = this.state["tools"] as AgentTool[];
        const write_tool = tools.find((tool) => tool.name === "write_glossary");
        if (write_tool === undefined) throw new Error("缺少 write_glossary");
        await write_tool.execute("write-1", {
          changes: [],
          expected_section_revisions: { quality: 3 },
        });
      } else {
        this.emit_assistant("已完成");
      }
      this.state["isStreaming"] = false;
    }

    public abort(): void {
      fake_agent_state.abort_count += 1;
      this.state["isStreaming"] = false;
      fake_agent_state.release_pending?.();
      fake_agent_state.release_pending = null;
    }

    public async waitForIdle(): Promise<void> {}

    private emit_assistant(text: string): void {
      const message = {
        role: "assistant",
        content: [{ type: "text", text }],
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
      this.listener?.({ type: "message_start", message });
      this.listener?.({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "text_delta", delta: text, partial: message },
      });
      this.listener?.({ type: "message_end", message });
    }
  }

  return {
    Agent: FakeAgent,
    uuidv7: () => `message-${(fake_agent_state.id += 1).toString()}`,
  };
});

import { AgentService } from "./agent-service";

describe("AgentService", () => {
  const services: AgentService[] = [];

  beforeEach(() => {
    fake_agent_state.mode = "complete";
    fake_agent_state.abort_count = 0;
    fake_agent_state.id = 0;
    fake_agent_state.system_prompts = [];
    fake_agent_state.release_pending = null;
    skill_loader.mockClear();
  });

  afterEach(async () => {
    await Promise.all(services.splice(0).map(async (service) => await service.dispose()));
  });

  it("快照下发启动期 skill 清单，未知 skill 被拒绝", async () => {
    const fixture = await create_service();

    expect(fixture.service.get_snapshot().skills).toEqual([
      { name: "glossary-audit", description: "审校术语" },
    ]);
    expect(() => fixture.service.send_message({ text: "执行", skill: "missing" })).toThrow(
      "request.validation_failed",
    );

    fixture.service.send_message({ text: "执行", skill: "glossary-audit" });
    await wait_for_complete(fixture.service);
    expect(fake_agent_state.system_prompts.at(-1)).toContain("执行术语审校。");
  });

  it("systemPrompt 只注入 essentials 与 reference_index，不含 references 正文", async () => {
    const fixture = await create_service();

    fixture.service.send_message({ text: "执行", skill: "glossary-audit" });
    await wait_for_complete(fixture.service);
    const prompt = fake_agent_state.system_prompts.at(-1) ?? "";

    expect(prompt).toContain("执行术语审校。");
    expect(prompt).toContain("audit-standard.md: 审校标准");
    expect(prompt).not.toContain("完整正文。");
  });

  it("模型回合只经历 running 到 complete", async () => {
    const { service } = await create_service();

    service.send_message({ text: "开始" });
    expect(service.get_snapshot().state).toBe("running");
    await wait_for_complete(service);

    expect(service.get_snapshot()).toMatchObject({
      state: "complete",
      messages: [
        { role: "user", text: "开始" },
        { role: "assistant", text: "已完成", complete: true },
      ],
    });
  });

  it("请求失败发布 typed event 并结束回合，不在后端拼用户文案", async () => {
    const { service, publish, log_error } = await create_service();
    fake_agent_state.mode = "failure";

    service.send_message({ text: "开始" });
    await wait_for_complete(service);

    expect(publish).toHaveBeenCalledWith("agent.session_event", { type: "request_failed" });
    expect(log_error).toHaveBeenCalledWith(
      "Agent 模型回合失败",
      expect.objectContaining({ source: "agent", error: expect.any(Error) }),
    );
    expect(service.get_snapshot()).toMatchObject({
      state: "complete",
      messages: [{ role: "user", text: "开始" }],
    });
  });

  it("own-write 的 project change 只推进 binding，外部 quality 变更仍清空会话", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "write";

    service.send_message({ text: "写入", skill: "glossary-audit" });
    await wait_for_complete(service);
    expect(service.get_snapshot().messages).toHaveLength(1);

    service.handle_project_change(project_change(5));
    expect(service.get_snapshot()).toEqual({
      state: "idle",
      messages: [],
      toolStatuses: [],
      skills: [{ name: "glossary-audit", description: "审校术语" }],
    });
  });

  it("停止会中断当前回合并回到 idle", async () => {
    const { service } = await create_service();
    fake_agent_state.mode = "pending";
    service.send_message({ text: "开始" });

    expect(service.stop().state).toBe("idle");
    expect(fake_agent_state.abort_count).toBe(1);
  });

  it("清除 skill 后恢复基础 system prompt", async () => {
    const { service } = await create_service();

    service.send_message({ text: "审校", skill: "glossary-audit" });
    await wait_for_complete(service);
    service.send_message({ text: "普通对话" });
    await wait_for_complete(service);

    expect(fake_agent_state.system_prompts.at(-2)).toContain("执行术语审校。");
    expect(fake_agent_state.system_prompts.at(-1)).not.toContain("执行术语审校。");
  });

  async function create_service(): Promise<{
    service: AgentService;
    publish: ReturnType<typeof vi.fn>;
    log_error: ReturnType<typeof vi.fn>;
  }> {
    const session_state = new ProjectSessionState();
    await session_state.mark_loaded("test.lg");
    let revision = 3;
    let service!: AgentService;
    const cache = {
      snapshot: () => ({
        projectPath: "test.lg",
        epoch: 1,
        freshness: "fresh" as const,
        sectionRevisions: { quality: revision },
        itemCount: 0,
      }),
      items: { readItems: () => [] },
    };
    const settings = {
      read_setting: () => ({
        activate_model_id: "active",
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
        ],
      }),
    };
    const quality_rules = {
      read: () => ({
        sectionRevisions: { quality: revision },
        qualityRule: { entries: [] },
      }),
      save_rule_entries: async (): Promise<ProjectWriteResult> => {
        revision += 1;
        service.handle_project_change(project_change(revision));
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
      },
      settings,
      sessionState: session_state,
      cache,
      qualityRules: quality_rules,
      logManager: { error: log_error, warning: vi.fn() },
      publish,
    });
    await service.load_skills();
    services.push(service);
    return { service, publish, log_error };
  }
});

function project_change(revision: number): ProjectChangeEvent {
  return {
    type: "project.changed" as const,
    eventId: `quality-${revision.toString()}`,
    source: "quality_rule_save_entries",
    projectPath: "test.lg",
    projectRevision: revision,
    sectionRevisions: { quality: revision },
    updatedSections: ["quality"],
  };
}

async function wait_for_complete(service: AgentService): Promise<void> {
  await vi.waitFor(() => expect(service.get_snapshot().state).toBe("complete"));
}
