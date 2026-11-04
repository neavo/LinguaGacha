import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { GODOT_PACK_ORDER_REFRESH_ACTION } from "@shared/godot";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { useProjectCreateFlow } from "./use-project-create-flow";
import type { RunProjectLoad } from "./use-project-load";
import { PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY } from "./project-language-preference";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  loaded: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
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
  vi.clearAllMocks();
  desktop_descriptor = Object.getOwnPropertyDescriptor(window, "desktopApp");
  localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  mocks.state.settings_snapshot = {
    project_save_mode: "SOURCE",
    project_fixed_path: "",
    glossary_default_preset: "",
  };
  mocks.api.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith("/summary")) return { source_file_count: 2, format_hit_counts: { txt: 2 } };
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
  vi.restoreAllMocks();
  if (desktop_descriptor) Object.defineProperty(window, "desktopApp", desktop_descriptor);
  else Reflect.deleteProperty(window, "desktopApp");
});
/** 从语言确认入口推进创建。 */
async function create() {
  await act(async () => flow.open_language_dialog());
  await act(async () => flow.confirm_language_dialog());
}

it.each(["SOURCE", "MANUAL", "FIXED"])("%s 保存模式使用完整来源并提交保存路径", async (mode) => {
  mocks.state.settings_snapshot.project_save_mode = mode;
  mocks.state.settings_snapshot.glossary_default_preset = "test-preset";
  await act(async () => flow.handle_select_source_paths(["E:/source/a.txt", "E:/source/b.txt"]));
  await create();
  const path =
    mode === "SOURCE" ? "E:/source/a.lg" : mode === "MANUAL" ? "E:/manual.lg" : "E:/fixed/a.lg";
  expect(mocks.api).toHaveBeenCalledWith(
    "/api/session/project/create",
    expect.objectContaining({ path, source_paths: ["E:/source/a.txt", "E:/source/b.txt"] }),
  );
  expect(mocks.loaded).toHaveBeenCalledWith("E:/actual.lg");
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("术语表"));
  expect(flow.open).toBe(false);
});

it("空工程通过保存选择器取得路径", async () => {
  await create();
  expect(window.desktopApp.pickProjectSavePath).toHaveBeenCalledOnce();
  expect(mocks.api).toHaveBeenCalledWith(
    "/api/session/project/create",
    expect.objectContaining({ source_paths: [], path: "E:/manual.lg" }),
  );
});

it("来源失效清空选择，后续选择可恢复", async () => {
  await act(async () => flow.handle_select_source_paths(["E:/valid.txt"]));
  mocks.api.mockResolvedValueOnce({ source_file_count: 0 });
  await act(async () => flow.handle_select_source_paths(["E:/invalid"]));
  expect(flow.selected_source).toBeNull();
  expect(mocks.toast).toHaveBeenCalledWith("warning", expect.any(String));
  await act(async () => flow.handle_select_source_paths(["E:/retry.txt"]));
  expect(flow.selected_source?.source_paths).toEqual(["E:/retry.txt"]);
});

it("创建失败保留来源和语言，重试成功后关闭，再打开重置来源", async () => {
  await act(async () => flow.handle_select_source_paths(["E:/keep.txt"]));
  act(() => flow.set_create_languages({ source_language: "JA", target_language: "EN" }));
  mocks.api.mockRejectedValueOnce(new Error("failed"));
  await create();
  expect(flow.open).toBe(true);
  expect(flow.selected_source?.source_paths).toEqual(["E:/keep.txt"]);
  await create();
  expect(mocks.api).toHaveBeenCalledWith(
    "/api/session/project/create",
    expect.objectContaining({ languages: { source_language: "JA", target_language: "EN" } }),
  );
  await act(async () => root.unmount());
  await mount();
  expect(flow.create_languages).toEqual({ source_language: "JA", target_language: "EN" });
  expect(flow.selected_source).toBeNull();
});

it("游戏来源在备份与包顺序确认后提交，包列表失效会刷新来源", async () => {
  const packs = [
    { game_root: "E:/game", game_name: "game", external_pcks: ["base.pck", "patch.pck"] },
  ];
  mocks.api.mockResolvedValueOnce({
    source_file_count: 1,
    contains_game: true,
    godot_packs: packs,
  });
  await act(async () => flow.handle_select_source_paths(["E:/game"]));
  act(() => {
    void flow.open_language_dialog();
  });
  expect(flow.backup_confirm.dialog_props.open).toBe(true);
  expect(flow.is_language_dialog_open).toBe(false);
  await act(async () => flow.backup_confirm.dialog_props.onConfirm());
  await act(async () => flow.confirm_language_dialog());
  expect(flow.pack_order.dialog_props.games).toHaveLength(1);
  expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/create"))).toBe(false);
  mocks.api.mockRejectedValueOnce(
    new DesktopApiError({
      code: "request.validation_failed",
      details: { action: GODOT_PACK_ORDER_REFRESH_ACTION },
    }),
  );
  await act(async () => flow.pack_order.dialog_props.on_confirm());
  expect(mocks.api).toHaveBeenLastCalledWith("/api/session/source-files/summary", {
    source_paths: ["E:/game"],
  });
  expect(flow.open).toBe(true);
  expect(flow.source_selection_disabled).toBe(false);
});
