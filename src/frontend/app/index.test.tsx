import { EditorView } from "@codemirror/view";
import { act, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentChatSnapshot } from "@shared/agent";
import { create_text_resolver } from "@shared/i18n";
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
  exportedRoundId: null,
};

function start_without_project(
  snapshot: Promise<AgentChatSnapshot> = Promise.resolve(agent),
): void {
  desktop.api_get.mockImplementation(async (route: string) => {
    if (route === "/api/session/projects") return { projects: [] };
    if (route === `/api/agent/snapshot?projectId=${project.projectId}`) return snapshot;
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
        return { project };
      case "/api/skills/snapshot":
        return { skills: [] };
      case "/api/agent/skills":
        return [];
      case "/api/batch-task/snapshot":
        return { batch_tasks: empty_batch_task_list_snapshot() };
      case "/api/agent/message":
        return { revision: agent.revision, status: "accepted" };
      default:
        return {};
    }
  });
}

const editor = () => EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
const button = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

it("无工程发送时落盘空工程，切到全局页后仍会向新会话发送一次", async () => {
  vi.useFakeTimers();
  const snapshot = Promise.withResolvers<AgentChatSnapshot>();
  start_without_project(snapshot.promise);
  const source_path = "E:/sources/story.png";
  const pickProjectFilePath = vi.fn(async () => ({ canceled: true, paths: [] }));

  await render_app({ methods: { getPathForFile: () => source_path, pickProjectFilePath } });
  await act(async () => stream.onopen());
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: { types: ["Files"], files: [new File(["story"], "story.png")] },
  });
  await act(async () => container.querySelector(".cm-content")!.dispatchEvent(drop));
  const draft = editor().state.doc.toString();
  expect(draft).toContain(`@file("${source_path}")`);
  expect(container.querySelector(".agent-attachment")).toBeNull();
  expect(
    desktop.api_fetch.mock.calls.some(([route]) => route === "/api/session/project/create"),
  ).toBe(false);
  const send = container.querySelector<HTMLButtonElement>(".agent-composer__submit")!;
  await act(async () => {
    send.click();
    send.click();
    button("打开工程").click(); // 同帧发起的打开和重复发送都受应用会话互斥。
  });
  expect(pickProjectFilePath).not.toHaveBeenCalled();
  expect(desktop.api_fetch).toHaveBeenCalledWith("/api/session/project/default-name", {
    source_paths: [source_path],
  });
  expect(
    desktop.api_fetch.mock.calls.filter(([route]) => route === "/api/session/project/create"),
  ).toEqual([
    [
      "/api/session/project/create",
      {
        path: project.path,
        source_paths: [],
        languages: { source_language: "JA", target_language: "ZH" },
      },
    ],
  ]);
  await act(async () => vi.runOnlyPendingTimersAsync());
  expect(container.querySelector('[aria-current="page"]')?.textContent).toContain(project.name);
  expect(desktop.api_fetch.mock.calls.some(([route]) => route === "/api/agent/message")).toBe(
    false,
  );
  await act(async () => button("技能").click());
  await act(async () => snapshot.resolve(agent));
  const messages = desktop.api_fetch.mock.calls.filter(([route]) => route === "/api/agent/message");
  expect(messages).toEqual([
    [
      "/api/agent/message",
      expect.objectContaining({
        projectId: project.projectId,
        chatId: agent.chatId,
        text: draft,
        attachments: [],
      }),
    ],
  ]);
});

it("侧栏创建空工程，进入 Agent 并选中预置指令的路径占位符", async () => {
  vi.useFakeTimers();
  start_without_project();
  localStorage.setItem(
    PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY,
    JSON.stringify({
      source_language: "EN",
      target_language: "ZH",
    }),
  );
  const pickProjectSavePath = vi.fn(async () => ({ canceled: false, paths: [project.path] }));
  await render_app({ methods: { pickProjectSavePath } });
  await act(async () => button("创建工程").click());
  expect(pickProjectSavePath).not.toHaveBeenCalled();
  const confirm = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-keyshortcuts="Enter"]',
  )!;
  await act(async () => confirm.click());

  expect(pickProjectSavePath).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/^lg_project_\d{8}_\d{6}\.lg$/u),
  );
  expect(desktop.api_fetch).toHaveBeenCalledWith("/api/session/project/create", {
    path: project.path,
    source_paths: [],
    languages: { source_language: "EN", target_language: "ZH" },
  });
  await act(async () => vi.runOnlyPendingTimersAsync());
  expect(container.querySelector('[aria-current="page"]')?.textContent).toContain(project.name);
  const state = editor().state;
  const { from, to } = state.selection.main;
  expect(state.sliceDoc(from, to)).toBe(
    create_text_resolver("zh-CN")("app.agent_input.path_placeholder"),
  );
  expect(desktop.api_fetch.mock.calls.some(([route]) => route === "/api/agent/message")).toBe(
    false,
  );
});

it("无工程时从技能页交给 Agent，保留原草稿并选中预填占位符", async () => {
  start_without_project();
  await render_app({});
  await act(async () => editor().dispatch({ changes: { from: 0, insert: "原草稿" } }));
  await act(async () => button("技能").click());
  await act(async () => button("安装指南").click());
  const action = document.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-primary-action"]',
  )!;
  await act(async () => action.click());
  const state = editor().state;
  const { from, to } = state.selection.main;
  expect(state.doc.toString()).toBe("原草稿\n请帮我安装这个技能：[在这里输入技能链接]");
  expect(state.sliceDoc(from, to)).toBe("[在这里输入技能链接]");
  expect(
    desktop.api_fetch.mock.calls.some(([route]) => route === "/api/session/project/create"),
  ).toBe(false);
});
