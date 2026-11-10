import { GODOT_PACK_ORDER_REFRESH_ACTION } from "@shared/godot";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import type { AgentInputRequest } from "@frontend/app/navigation/types";
import { create_text_resolver } from "@shared/i18n";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { useProjectCreateFlow } from "./use-project-create-flow";
import type { RunProjectLoad } from "./use-project-load";
import { PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY } from "./project-language-preference";

const t = create_text_resolver("zh-CN");
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  loaded: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(),
  state: {
    settings_snapshot: {
      project_save_mode: "SOURCE",
      project_fixed_path: "",
      glossary_default_preset: "",
    },
    refresh_settings: vi.fn(),
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({ useDesktopState: () => mocks.state }));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: mocks.navigate }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: mocks.toast,
  push_error_toast: mocks.error,
}));
/** 执行请求并记录交给公共加载流程的工程路径。 */
const run_project_load: RunProjectLoad = async ({ request }) => {
  mocks.loaded(await request());
};

let flow: ReturnType<typeof useProjectCreateFlow>;
let root: Root;
let desktop_descriptor: PropertyDescriptor | undefined;
/** 通过真实 Hook 观察创建意图。 */
function Probe() {
  flow = useProjectCreateFlow(run_project_load);
  return null;
}
/** 重挂载用于验证已确认语言偏好的恢复。 */
async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <LocaleProvider locale="zh-CN">
        <Probe />
      </LocaleProvider>,
    ),
  );
  act(() => flow.show());
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  desktop_descriptor = Object.getOwnPropertyDescriptor(window, "desktopApp");
  localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  mocks.state.settings_snapshot = {
    project_save_mode: "SOURCE",
    project_fixed_path: "",
    glossary_default_preset: "",
  };
  mocks.api.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith("/create")) return { project: { path: "E:/actual.lg" } };
    return {};
  });
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    value: create_desktop_bridge_api_mock({
      methods: {
        pickProjectSavePath: vi.fn(async () => ({ canceled: false, paths: ["E:/manual.lg"] })),
        pickDirectory: vi.fn(async () => ({ canceled: false, paths: ["E:/fixed"] })),
      },
    }),
  });
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (desktop_descriptor) Object.defineProperty(window, "desktopApp", desktop_descriptor);
  else Reflect.deleteProperty(window, "desktopApp");
});
/** 从语言确认入口推进创建。 */
async function create() {
  await act(async () => {
    await flow.open_language_dialog();
  });
  expect(flow.is_language_dialog_open).toBe(true);
  await act(async () => flow.confirm_language_dialog());
}

it.each([
  ["SOURCE", "E:/manual.lg"],
  ["MANUAL", "E:/manual.lg"],
  ["FIXED", expect.stringMatching(/^E:\/fixed\/[^/]+\.lg$/u)],
])("%s 保存模式创建空工程，加载完成后预置翻译草稿", async (mode, path) => {
  mocks.state.settings_snapshot.project_save_mode = mode;
  mocks.state.settings_snapshot.glossary_default_preset = "test-preset";
  await create();
  expect(mocks.api).toHaveBeenCalledWith("/api/session/project/create", {
    path,
    source_paths: [],
    languages: expect.any(Object),
  });
  expect(mocks.loaded).not.toHaveBeenCalled();
  expect(flow.source_selection_disabled).toBe(true);
  await act(async () => vi.runAllTimersAsync());
  expect(mocks.loaded).toHaveBeenCalledWith("E:/actual.lg");
  expect(mocks.toast).toHaveBeenCalledWith("success", expect.any(String));
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.any(String));
  expect(flow.open).toBe(false);
  const request: AgentInputRequest = mocks.navigate.mock.calls[0]![0];
  expect(request.text.slice(request.selection!.from, request.selection!.to)).toBe(
    t("app.agent_input.path_placeholder"),
  );
  expect(request.text).toContain(`\n\n${t("app.agent_input.steps_intro_after_instruction")}\n1. `);
});

it("取消保存位置不创建也不预置草稿", async () => {
  vi.mocked(window.desktopApp.pickProjectSavePath).mockResolvedValueOnce({
    canceled: true,
    paths: [],
  });
  await create();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(flow.open).toBe(true);
  expect(flow.source_selection_disabled).toBe(false);
});

it("创建失败保留弹窗与语言，重试成功后关闭，重挂载恢复语言偏好", async () => {
  act(() => flow.set_create_languages({ source_language: "JA", target_language: "EN" }));
  mocks.api.mockRejectedValueOnce(new Error("failed"));
  await create();
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(flow.open).toBe(true);
  await create();
  await act(async () => vi.runAllTimersAsync());
  expect(mocks.api).toHaveBeenLastCalledWith(
    "/api/session/project/create",
    expect.objectContaining({ languages: { source_language: "JA", target_language: "EN" } }),
  );
  expect(flow.open).toBe(false);
  await act(async () => root.unmount());
  await mount();
  expect(flow.create_languages).toEqual({ source_language: "JA", target_language: "EN" });
});

const game_summary = {
  source_file_count: 1,
  project_name: "Game.v1.2",
  format_hit_counts: { godot: 1 },
  contains_game: true,
  godot_packs: [
    {
      game_root: "E:/games/Game.v1.2",
      game_name: "Game.v1.2",
      external_pcks: ["base.pck", "patch.pck"],
    },
  ],
};

it("拖入创建清除旧来源，按首个路径保存并预填全部路径，重新打开对话框清除拖入意图", async () => {
  mocks.api.mockResolvedValueOnce(game_summary);
  await act(async () => flow.handle_select_source_paths(["E:/games/Game.v1.2"]));
  act(() => flow.close());
  act(() => flow.start_from_paths(["E:/src/a.txt", "E:/src/b"]));
  expect(flow.open).toBe(false);
  expect(flow.is_language_dialog_open).toBe(true);
  expect(flow.backup_confirm.dialog_props.open).toBe(false);
  await act(async () => flow.confirm_language_dialog());
  expect(mocks.api).toHaveBeenLastCalledWith("/api/session/project/create", {
    source_paths: [],
    path: expect.stringMatching(/^E:\/src\/[^/]+\.lg$/u),
    languages: expect.any(Object),
  });
  expect(window.desktopApp.pickProjectSavePath).not.toHaveBeenCalled();
  await act(async () => vi.runAllTimersAsync());
  const request: AgentInputRequest = mocks.navigate.mock.calls[0]![0];
  expect(request.text).toContain("E:/src/a.txt\nE:/src/b");

  act(() => flow.show());
  await create();
  expect(window.desktopApp.pickProjectSavePath).toHaveBeenCalledOnce();
  await act(async () => vi.runAllTimersAsync());
  const next_request: AgentInputRequest = mocks.navigate.mock.calls[1]![0];
  expect(next_request.text).not.toContain("E:/src/");
  expect(next_request.selection).toBeDefined();
});

it("游戏来源依次确认备份、语言和包顺序，按摘要名称在来源目录创建", async () => {
  mocks.api.mockResolvedValueOnce(game_summary);
  await act(async () => flow.handle_select_source_paths(["E:/games/Game.v1.2"]));
  act(() => {
    void flow.open_language_dialog();
  });
  expect(flow.backup_confirm.dialog_props.open).toBe(true);
  expect(flow.is_language_dialog_open).toBe(false);
  await act(async () => flow.backup_confirm.finish(true));
  expect(flow.is_language_dialog_open).toBe(true);
  await act(async () => flow.confirm_language_dialog());
  expect(flow.pack_order.dialog_props.games).toEqual(game_summary.godot_packs);
  expect(mocks.loaded).not.toHaveBeenCalled();
  await act(async () => flow.pack_order.dialog_props.on_confirm());
  expect(window.desktopApp.pickProjectSavePath).not.toHaveBeenCalled();
  expect(mocks.api).toHaveBeenLastCalledWith("/api/session/project/create", {
    source_paths: ["E:/games/Game.v1.2"],
    path: "E:/games/Game.v1.2.lg",
    godot_pack_orders: [
      { game_root: "E:/games/Game.v1.2", ordered_pcks: ["base.pck", "patch.pck"] },
    ],
    languages: expect.any(Object),
  });
  expect(mocks.loaded).toHaveBeenCalledWith("E:/actual.lg");
  const request: AgentInputRequest = mocks.navigate.mock.calls[0]![0];
  expect(request.selection).toBeUndefined();
  expect(request.text.startsWith(`${t("app.agent_input.steps_intro")}\n1. `)).toBe(true);
});

it("来源摘要补齐无效计数，无可用文件或请求失败时清空并提示", async () => {
  for (const failure of [false, true]) {
    mocks.api.mockResolvedValueOnce({
      source_file_count: 2.8,
      format_hit_counts: { txt: 1.9, md: -3, epub: "bad", json: true, srt: [2] },
      godot_packs: false,
    });
    await act(async () => flow.handle_select_source_paths(["E:/text.txt"]));
    expect(flow.selected_source).toMatchObject({
      source_file_count: 2,
      format_hit_counts: { txt: 1, md: 0, epub: 0, godot: 0, json: 0, srt: 0 },
      project_name: "",
      contains_game: false,
      godot_packs: [],
    });
    if (failure) mocks.api.mockRejectedValueOnce(new Error("unavailable"));
    else mocks.api.mockResolvedValueOnce({ source_file_count: 0 });
    await act(async () => flow.handle_select_source_paths(["E:/invalid.bin"]));
    expect(flow.selected_source).toBeNull();
    expect(flow.source_selection_disabled).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith("warning", expect.any(String));
  }
});

it("包列表变化时重新摘要原始来源并保留创建入口", async () => {
  mocks.api.mockResolvedValueOnce({ ...game_summary, contains_game: false, godot_packs: [] });
  await act(async () => flow.handle_select_source_paths(["E:/games/Game.v1.2"]));
  mocks.api.mockRejectedValueOnce(
    new DesktopApiError({
      code: "request.validation_failed",
      details: { action: GODOT_PACK_ORDER_REFRESH_ACTION },
    }),
  );
  mocks.api.mockResolvedValueOnce(game_summary);
  await create();
  expect(mocks.api).toHaveBeenLastCalledWith("/api/session/source-files/summary", {
    source_paths: ["E:/games/Game.v1.2"],
  });
  expect(flow.selected_source?.godot_packs).toEqual(game_summary.godot_packs);
  expect(flow.open).toBe(true);
  expect(mocks.error).toHaveBeenCalledOnce();
});
