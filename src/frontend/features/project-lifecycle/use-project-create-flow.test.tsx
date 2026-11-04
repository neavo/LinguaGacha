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
  vi.restoreAllMocks();
  if (desktop_descriptor) Object.defineProperty(window, "desktopApp", desktop_descriptor);
  else Reflect.deleteProperty(window, "desktopApp");
});
/** 从语言确认入口推进创建。 */
async function create() {
  act(() => flow.open_language_dialog());
  expect(flow.is_language_dialog_open).toBe(true);
  await act(async () => flow.confirm_language_dialog());
}

it.each([
  ["SOURCE", "E:/manual.lg"],
  ["MANUAL", "E:/manual.lg"],
  ["FIXED", expect.stringMatching(/^E:\/fixed\/lg_project_.+\.lg$/u)],
])("%s 保存模式创建空工程，成功后提示并预置添加文件草稿", async (mode, path) => {
  mocks.state.settings_snapshot.project_save_mode = mode;
  mocks.state.settings_snapshot.glossary_default_preset = "test-preset";
  await create();
  expect(mocks.api).toHaveBeenCalledWith("/api/session/project/create", {
    path,
    languages: expect.any(Object),
  });
  expect(mocks.loaded).toHaveBeenCalledWith("E:/actual.lg");
  expect(mocks.toast).toHaveBeenCalledWith("success", t("project.create.success"));
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("术语表"));
  expect(flow.open).toBe(false);
  const request: AgentInputRequest = mocks.navigate.mock.calls[0]![0];
  expect(request.text.startsWith(t("project.create.add_files_draft.prompt"))).toBe(true);
  expect(request.text.slice(request.selection!.from, request.selection!.to)).toBe(
    t("project.create.add_files_draft.placeholder"),
  );
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
  expect(flow.is_creating_project).toBe(false);
});

it("创建失败保留弹窗与语言，重试成功后关闭，重挂载恢复语言偏好", async () => {
  act(() => flow.set_create_languages({ source_language: "JA", target_language: "EN" }));
  mocks.api.mockRejectedValueOnce(new Error("failed"));
  await create();
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(flow.open).toBe(true);
  await create();
  expect(mocks.api).toHaveBeenLastCalledWith(
    "/api/session/project/create",
    expect.objectContaining({ languages: { source_language: "JA", target_language: "EN" } }),
  );
  expect(flow.open).toBe(false);
  await act(async () => root.unmount());
  await mount();
  expect(flow.create_languages).toEqual({ source_language: "JA", target_language: "EN" });
});
