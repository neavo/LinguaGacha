import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DesktopStateProvider } from "./desktop-state-provider";
import { useDesktopState, useProjectChangeSignal, useBatchTaskSnapshot } from "./use-desktop-state";
import { empty_batch_task_list_snapshot } from "@shared/batch-task";
import { AGENT_CHAT_EVENT_TOPIC, type AgentChatSnapshot } from "@shared/agent";

const desktop = vi.hoisted(() => ({
  api_get: vi.fn(),
  api_fetch: vi.fn(),
  open_event_stream: vi.fn(),
  report_renderer_error: vi.fn(async () => {}),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => desktop);

it("按打开周期接收后台工程事件，切换时恢复原工程的任务和变更", async () => {
  const listeners = new Map<string, EventListener>();
  const close = vi.fn();
  let project_ids = ["first", "second"];
  let current_task_revision = 0;
  desktop.open_event_stream.mockReturnValue({
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    close,
  });
  const agent_snapshot: AgentChatSnapshot = {
    chatId: "second-chat",
    revision: 1,
    state: "idle",
    pendingDecision: null,
    entries: [],
    skills: [],
    inputQueue: { paused: false, canSendNow: false, items: [] },
    doing: null,
    context: { tokens: null, compactable: false, limits: null },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    tokenSpeed: null,
    runOutput: null,
    exportedRoundId: null,
  };
  desktop.api_get.mockImplementation(async (route: string) => {
    const { pathname, searchParams } = new URL(route, "http://localhost");
    if (pathname === "/api/session/projects")
      return {
        projects: project_ids.map((projectId) => ({
          project: {
            projectId,
            path: projectId + ".lg",
            name: projectId,
            loaded: true,
            file_count: 0,
          },
        })),
      };
    return { ...agent_snapshot, chatId: searchParams.get("projectId") + "-chat" };
  });
  desktop.api_fetch.mockImplementation(async (route: string, body?: Record<string, unknown>) => {
    if (route === "/api/settings/app") return { settings: { app_language: "EN" } };
    if (route === "/api/runtime/snapshot")
      return { runtime: { revision: 1, owner: null, projects: {} } };
    if (route === "/api/session/project/snapshot") {
      const projectId = String(body?.projectId ?? "first");
      return {
        project: {
          projectId,
          path: projectId + ".lg",
          name: projectId,
          loaded: true,
          file_count: 2,
          quality_rule_counts: {
            glossary: 5,
            text_preserve: 1,
            pre_replacement: 0,
            post_replacement: 3,
          },
          settings: {
            source_language: "EN",
            target_language: "ZH",
            mtool_optimizer_enable: false,
            skip_duplicate_source_text_enable: true,
          },
        },
      };
    }
    return {
      batch_tasks: {
        ...empty_batch_task_list_snapshot(),
        project_path: String(body?.projectId) + ".lg",
        revision: current_task_revision,
      },
    };
  });
  let state!: ReturnType<typeof useDesktopState>;
  let signal!: ReturnType<typeof useProjectChangeSignal>;
  let task!: ReturnType<typeof useBatchTaskSnapshot>;
  function Probe(): null {
    state = useDesktopState();
    signal = useProjectChangeSignal();
    task = useBatchTaskSnapshot();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const emit = (topic: string, payload: object) =>
    listeners.get(topic)?.(new MessageEvent(topic, { data: JSON.stringify(payload) }));
  try {
    await act(async () =>
      root.render(
        <DesktopStateProvider>
          <Probe />
        </DesktopStateProvider>,
      ),
    );
    expect(state.initial_state_status).toBe("ready");
    expect(state.settings_snapshot.app_language).toBe("EN");
    expect(state.project_snapshot.projectId).toBe("first");
    expect(desktop.open_event_stream).toHaveBeenCalledOnce();
    const reads = () =>
      desktop.api_fetch.mock.calls
        .filter(([route]) => route === "/api/batch-task/snapshot")
        .map(([, body]) => body?.projectId);
    expect(reads()).toEqual(["first", "second"]);
    const agent = state.open_projects[1]!.agentChat;

    const change = {
      projectId: "second",
      projectPath: "second.lg",
      eventId: "only-second",
      source: "test",
      projectRevision: 1,
      updatedSections: ["knowledge"],
      sectionRevisions: { knowledge: 1 },
      qualityStatisticsScope: "none",
    };
    await act(async () => {
      emit("project.data_changed", change);
      emit("project.data_changed", change);
      emit("batch_task.snapshot_changed", {
        projectId: "second",
        batch_tasks: {
          ...empty_batch_task_list_snapshot(),
          project_path: "second.lg",
          revision: 2,
        },
      });
      emit(AGENT_CHAT_EVENT_TOPIC, {
        projectId: "second",
        type: "snapshot_seed",
        revision: 2,
        snapshot: { ...agent_snapshot, revision: 2, chatId: "second-reset" },
      });
    });
    expect(signal.seq).toBe(0);
    expect(task.revision).toBe(0);
    await act(async () => state.select_project("second"));
    expect(signal.seq).toBe(1);
    expect(signal.results[0]?.eventId).toBe("only-second");
    expect(task.revision).toBe(2);
    expect(reads()).toEqual(["first", "second"]);
    expect(state.active_project?.agentChat).toBe(agent);
    expect(agent.get_chat_id()).toBe("second-reset");
    current_task_revision = 3;
    await act(async () =>
      emit("batch_task.snapshot_changed", { projectId: "second", batch_tasks: null }),
    );
    expect(reads()).toEqual(["first", "second", "second"]);
    expect(task.revision).toBe(3);
    await act(async () => state.select_project("first"));
    expect(signal.seq).toBe(0);
    await act(async () => {
      emit("project.data_changed", {
        projectId: "first",
        projectPath: "first.lg",
        eventId: "quality-first",
        source: "test",
        projectRevision: 2,
        updatedSections: ["quality"],
        sectionRevisions: { quality: 2 },
        qualityStatisticsScope: "all",
      });
    });
    expect(state.active_project?.snapshot.quality_rule_counts).toEqual({
      glossary: 5,
      text_preserve: 1,
      pre_replacement: 0,
      post_replacement: 3,
    });
    expect(state.active_project?.snapshot.settings).toEqual({
      source_language: "EN",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });
    project_ids = ["first"];
    await act(async () => {
      await state.refresh_projects();
      emit(AGENT_CHAT_EVENT_TOPIC, {
        projectId: "second",
        type: "snapshot_seed",
        revision: 3,
        snapshot: { ...agent_snapshot, revision: 3, chatId: "closed" },
      });
    });
    expect(agent.get_chat_id()).toBe("second-reset");
  } finally {
    await act(async () => root.unmount());
  }
  expect(close).toHaveBeenCalledOnce();
});
