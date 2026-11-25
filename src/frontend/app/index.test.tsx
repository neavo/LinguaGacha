import { EditorView } from "@codemirror/view";
import { act, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentChatSnapshot } from "@shared/agent";
import { empty_batch_task_list_snapshot } from "@shared/batch-task";
import { PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY } from "@frontend/features/project-lifecycle/project-language-preference";
import {
  create_desktop_bridge_api_mock,
  type DesktopBridgeApiMockOverrides,
} from "../../test/desktop-bridge-mock";
import { usePageLeave } from "./navigation/page-leave-context";
import App from "./index";

const desktop = vi.hoisted(() => ({
  api_get: vi.fn(),
  api_fetch: vi.fn(),
  open_event_stream: vi.fn(),
  check_github_release_update: vi.fn(),
}));
const save = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock("./desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("./desktop/desktop-api")>()),
  ...desktop,
}));
vi.mock("@frontend/widgets/app-content-state", async (original) => {
  const { AppContentState } =
    await original<typeof import("@frontend/widgets/app-content-state")>();
  return {
    /** 更新用例借启动占位挂载保存回调，避免引入具体业务编辑页。 */
    AppContentState(props: ComponentProps<typeof AppContentState>) {
      const { register_before_leave } = usePageLeave();
      useEffect(() => register_before_leave(save), [register_before_leave]);
      return <AppContentState {...props} />;
    },
  };
});

let container: HTMLDivElement;
let root: Root;
let stream: { onopen: () => void; addEventListener: () => void; close: () => void };

beforeEach(() => {
  vi.resetAllMocks();
  desktop.api_fetch.mockResolvedValue({});
  desktop.check_github_release_update.mockResolvedValue(null);
  stream = { onopen: () => {}, addEventListener: () => {}, close: () => {} };
  desktop.open_event_stream.mockReturnValue(stream);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render_app(overrides: DesktopBridgeApiMockOverrides): Promise<void> {
  vi.stubGlobal("desktopApp", create_desktop_bridge_api_mock(overrides));
  await act(async () => root.render(<App />));
}

it("更新重启等待页面保存，保存失败后允许重试", async () => {
  const saved = Promise.withResolvers<boolean>();
  save.mockReturnValueOnce(saved.promise).mockResolvedValueOnce(true);
  desktop.api_get.mockReturnValue(new Promise(() => {})); // 保持启动占位，使保存回调在更新期间保持挂载。
  desktop.check_github_release_update.mockResolvedValue({
    latest_version: "1.2.4",
    release_url: "https://example.com/release",
    release_notes: "",
    windows_zip_urls: {},
  });
  const launchUpdate = vi.fn(async () => ({ status: "launched" as const }));
  await render_app({
    methods: {
      downloadUpdate: async ({ latest_version, release_url }) => ({
        status: "downloaded",
        latest_version,
        release_url,
        zip_path: "update.zip",
      }),
      launchUpdate,
    },
  });
  const confirm_update = () =>
    document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')!.click();
  await act(async () => confirm_update()); // 第一次确认下载，第二次确认重启。
  await act(async () => confirm_update());
  expect(save).toHaveBeenCalledOnce();
  expect(launchUpdate).not.toHaveBeenCalled();
  await act(async () => saved.resolve(false));
  expect(launchUpdate).not.toHaveBeenCalled();
  await act(async () => confirm_update());
  expect(launchUpdate).toHaveBeenCalledExactlyOnceWith({
    latest_version: "1.2.4",
    zip_path: "update.zip",
  });
});

it("空态拖入创建后只在新工程预填一次素材路径，且没有缺工程提醒", async () => {
  vi.useFakeTimers();
  const source_path = "E:/sources/story.txt";
  const project = {
    projectId: "created-project",
    path: "E:/sources/Story.lg",
    name: "Story.lg",
    loaded: true,
    file_count: 0,
  };
  const agent: AgentChatSnapshot = {
    chatId: "created-chat",
    revision: 1,
    state: "idle",
    pendingDecision: null,
    entries: [],
    skills: [],
    inputQueue: { paused: false, canSendNow: true, items: [] },
    doing: null,
    context: { tokens: null, compactable: false, limits: null },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    tokenSpeed: null,
    runOutput: null,
  };
  let created = false;
  desktop.api_get.mockImplementation(async (route: string) => {
    if (route === "/api/session/projects") return { projects: created ? [{ project }] : [] };
    if (route === `/api/agent/snapshot?projectId=${project.projectId}`) return agent;
    return {};
  });
  desktop.api_fetch.mockImplementation(async (route: string) => {
    switch (route) {
      case "/api/models/auth/snapshot":
        return { snapshot: { instance_id: "host", revision: 0, connected: false, login: null } };
      case "/api/settings/app":
      case "/api/settings/recent-projects/add":
        return { settings: { app_language: "ZH", project_save_mode: "SOURCE" } };
      case "/api/runtime/snapshot":
        return { runtime: { revision: 1, owner: null, projects: {} } };
      case "/api/session/project/default-name":
        return { project_name: "Story" };
      case "/api/session/project/create":
        created = true;
        return { project };
      case "/api/batch-task/snapshot":
        return { batch_tasks: empty_batch_task_list_snapshot() };
      default:
        return {};
    }
  });

  await render_app({ methods: { getPathForFile: () => source_path } });
  await act(async () => stream.onopen());
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: { types: ["Files"], files: [new File(["story"], "story.txt")] },
  });
  await act(async () => container.querySelector(".cm-content")!.dispatchEvent(drop));
  const confirm = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-keyshortcuts="Enter"]',
  )!;
  await act(async () => confirm.click());
  await act(async () => vi.runOnlyPendingTimersAsync());

  expect(container.querySelector('[aria-current="page"]')?.textContent).toContain(project.name);
  expect(container.querySelector(".sidebar-projects__header-actions[data-attention]")).toBeNull();
  const editor = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  expect(
    editor.state.doc
      .toString()
      .split("\n")
      .filter((line) => line === source_path),
  ).toHaveLength(1);
});
