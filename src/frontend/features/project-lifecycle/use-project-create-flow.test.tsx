import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_LANGUAGE_SETTINGS } from "@domain/project-settings";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { useProjectCreateFlow } from "./use-project-create-flow";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  state: {
    settings_snapshot: { project_save_mode: "SOURCE", project_fixed_path: "" },
    refresh_settings: vi.fn(),
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({ useDesktopState: () => mocks.state }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: mocks.toast,
  push_error_toast: mocks.error,
}));

const project = {
  projectId: "created",
  path: "E:/sources/game.lg",
  name: "game.lg",
  loaded: true as const,
  file_count: 0,
  quality_rule_counts: { glossary: 0, text_preserve: 0, pre_replacement: 0, post_replacement: 0 },
  settings: null,
};
const store = new ProjectStore(project);
const languages = DEFAULT_PROJECT_LANGUAGE_SETTINGS;
let create: ReturnType<typeof useProjectCreateFlow>;
let root: Root;

function Probe() {
  create = useProjectCreateFlow(async ({ request }) => {
    await request();
    return store;
  });
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.state.settings_snapshot = { project_save_mode: "SOURCE", project_fixed_path: "" };
  mocks.api.mockReset().mockImplementation(async (route: string) => {
    if (route.endsWith("/default-name")) return { project_name: "game" };
    if (route.endsWith("/create")) return { project };
    return {};
  });
  vi.stubGlobal(
    "desktopApp",
    create_desktop_bridge_api_mock({
      methods: {
        pickProjectSavePath: vi.fn(async () => ({ canceled: false, paths: ["E:/manual"] })),
        pickDirectory: vi.fn(async () => ({ canceled: false, paths: ["E:/fixed"] })),
      },
    }),
  );
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <LocaleProvider locale="zh-CN">
        <Probe />
      </LocaleProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("SOURCE 使用首个素材所在目录和后端名称创建空工程", async () => {
  const anchor_paths = ["E:/sources/game", "E:/other/notes.txt"];
  await expect(create({ languages, anchor_paths })).resolves.toBe(store);
  expect(mocks.api).toHaveBeenNthCalledWith(1, "/api/session/project/default-name", {
    source_paths: anchor_paths,
  });
  expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/session/project/create", {
    path: "E:/sources/game.lg",
    source_paths: [],
    languages,
  });
  expect(window.desktopApp.pickProjectSavePath).not.toHaveBeenCalled();
});

it("命名失败时在原目录使用时间戳；取消另存为时不创建工程", async () => {
  mocks.api.mockRejectedValueOnce(new Error("name unavailable"));
  await expect(create({ languages, anchor_paths: ["E:/sources/missing.txt"] })).resolves.toBe(
    store,
  );
  expect(mocks.api).toHaveBeenLastCalledWith("/api/session/project/create", {
    path: expect.stringMatching(/^E:\/sources\/lg_project_\d{8}_\d{6}\.lg$/u),
    source_paths: [],
    languages,
  });

  mocks.api.mockClear();
  mocks.state.settings_snapshot.project_save_mode = "MANUAL";
  vi.mocked(window.desktopApp.pickProjectSavePath).mockResolvedValueOnce({
    canceled: true,
    paths: [],
  });
  await expect(create({ languages })).resolves.toBeNull();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("FIXED 首次选择目录后保存偏好并在目录中创建空工程", async () => {
  mocks.state.settings_snapshot.project_save_mode = "FIXED";
  await expect(create({ languages })).resolves.toBe(store);
  expect(mocks.api).toHaveBeenNthCalledWith(1, "/api/settings/update", {
    project_fixed_path: "E:/fixed",
  });
  expect(mocks.state.refresh_settings).toHaveBeenCalledOnce();
  expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/session/project/create", {
    path: expect.stringMatching(/^E:\/fixed\/lg_project_\d{8}_\d{6}\.lg$/u),
    source_paths: [],
    languages,
  });
});
