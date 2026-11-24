import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DesktopStateProvider } from "./desktop-state-provider";
import { useDesktopState, useProjectChangeSignal, useBatchTaskSnapshot } from "./use-desktop-state";
import { empty_batch_task_snapshot } from "@shared/batch-task";

const desktop = vi.hoisted(() => ({
  api_get: vi.fn(),
  api_fetch: vi.fn(),
  open_event_stream: vi.fn(),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => desktop);

it("按打开周期接收后台工程事件，切换时恢复原工程的任务和变更", async () => {
  const listeners = new Map<string, EventListener>();
  const close = vi.fn();
  desktop.open_event_stream.mockReturnValue({
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    close,
  });
  desktop.api_get.mockImplementation(async (route: string) =>
    route === "/api/session/projects"
      ? {
          projects: ["first", "second"].map((projectId) => ({
            project: {
              projectId,
              path: projectId + ".lg",
              name: projectId,
              loaded: true,
              file_count: 0,
            },
            chats: [],
            activeChatId: "",
          })),
        }
      : {},
  );
  desktop.api_fetch.mockImplementation(async (route: string) => {
    if (route === "/api/settings/app") return { settings: { app_language: "EN" } };
    if (route === "/api/runtime/snapshot")
      return { runtime: { revision: 1, owner: null, projects: {} } };
    return { batch_task: empty_batch_task_snapshot() };
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
        batch_task: { ...empty_batch_task_snapshot(), revision: 2 },
      });
    });
    expect(signal.seq).toBe(0);
    expect(task.revision).toBe(0);
    await act(async () => state.select_project("second"));
    expect(signal.seq).toBe(1);
    expect(signal.results[0]?.eventId).toBe("only-second");
    expect(task.revision).toBe(2);
    await act(async () => state.select_project("first"));
    expect(signal.seq).toBe(0);
  } finally {
    await act(async () => root.unmount());
  }
  expect(close).toHaveBeenCalledOnce();
});
