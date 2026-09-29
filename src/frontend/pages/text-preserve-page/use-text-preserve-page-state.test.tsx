import { act } from "react";
import { normalize_setting_snapshot } from "@domain/setting";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSessionUiStateProvider } from "@frontend/app/session/project-session-ui-state-provider";
import { createEmptyQualityRuleStatisticsCacheSnapshot } from "@frontend/app/session/quality-rule-statistics-store";
import { useProjectWriteCommitter } from "@frontend/app/state/desktop-project-write";
import { useTextPreservePageState } from "./use-text-preserve-page-state";

const api = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const t = (key: string) => key;
const settings = normalize_setting_snapshot({});
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: api }));
vi.mock("@frontend/app/feedback/desktop-toast", async (import_actual) => ({
  ...(await import_actual<typeof import("@frontend/app/feedback/desktop-toast")>()),
  push_toast: toast,
  run_modal_progress_toast: async <T,>(args: { task: () => Promise<T> }) => args.task(),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({
    navigate_to_route: vi.fn(),
    push_proofreading_lookup_intent: vi.fn(),
  }),
}));
const statistics = createEmptyQualityRuleStatisticsCacheSnapshot();
vi.mock("@frontend/app/session/quality-rule-statistics-context", () => ({
  useQualityRuleStatistics: () => statistics,
}));
const project = { loaded: true, path: "project.lg" };
const writes = {
  applyProjectWriteChanges: async () => undefined,
  recovery: {
    report_state_error: vi.fn(),
    refresh_project_state_after_error: async () => undefined,
  },
};
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: project,
    settings_snapshot: settings,
    commit_project_write: useProjectWriteCommitter(writes),
  }),
  useRuntimeSnapshot: () => ({ revision: 0, owner: null }),
  useProjectChangeSignal: () => ({ seq: 0, reason: "initial", updated_sections: [], results: [] }),
}));

let root: ReturnType<typeof createRoot>;
let state: ReturnType<typeof useTextPreservePageState>;
let release: ReturnType<typeof Promise.withResolvers<void>>;
let updating: Promise<void> | undefined;

/** 页面拥有模式与校验行为；查询、提交和会话状态使用真实实现。 */
function Probe() {
  state = useTextPreservePageState();
  return null;
}
beforeEach(async () => {
  let mode = "custom";
  let revision = 1;
  release = Promise.withResolvers<void>();
  updating = undefined;
  api.mockReset();
  toast.mockClear();
  writes.recovery.report_state_error.mockClear();
  api.mockImplementation(async (route: string, request: { meta?: { mode: string } }) => {
    if (route === "/api/quality/rules/query") {
      return {
        projectPath: project.path,
        sectionRevisions: { quality: revision },
        qualityRule: { mode, enabled: true, entries: [], revision },
      };
    }
    if (route === "/api/quality/rules/update") {
      await release.promise;
      mode = request.meta!.mode;
      revision++;
      return {
        accepted: true,
        changes: [
          {
            projectPath: project.path,
            projectRevision: revision,
            updatedSections: ["quality"],
            sectionRevisions: { quality: revision },
          },
        ],
      };
    }
    throw new Error("Unexpected route: " + route);
  });
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <ProjectSessionUiStateProvider>
        <Probe />
      </ProjectSessionUiStateProvider>,
    ),
  );
});
afterEach(async () => {
  // 即使断言失败也先释放在途请求，再卸载组件。
  await act(async () => {
    release.resolve();
    await updating;
  });
  await act(async () => root.unmount());
});

it("模式切换期间忽略重复点击，响应后读取已提交模式并释放忙碌态", async () => {
  expect(state.mode).toBe("custom");
  api.mockClear();
  await act(async () => {
    updating = state.update_mode("smart");
  });
  await act(async () => state.update_mode("off"));
  expect(api).toHaveBeenCalledExactlyOnceWith("/api/quality/rules/update", {
    rule_type: "text_preserve",
    expected_section_revisions: { quality: 1 },
    meta: { mode: "smart" },
  });
  expect(state.mode_updating).toBe(true);
  await act(async () => {
    release.resolve();
    await updating;
  });
  expect(state.mode).toBe("smart");
  expect(state.mode_updating).toBe(false);
  expect(toast).not.toHaveBeenCalled();
  expect(writes.recovery.report_state_error).not.toHaveBeenCalled();
});

it("非法转义阻止保存，修改备注保留错误，修正规则清除错误", async () => {
  api.mockClear();
  await act(async () => state.editing.open_create_dialog());
  await act(async () => state.editing.update_dialog_draft({ src: "\\U0001F600", info: "旧写法" }));
  await act(async () => state.editing.save_dialog_entry());
  expect(state.editing.dialog_state.invalid).toBe(true);
  expect(api).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("error", expect.any(String));
  await act(async () => state.editing.update_dialog_draft({ info: "修正说明" }));
  expect(state.editing.dialog_state.invalid).toBe(true);
  await act(async () => state.editing.update_dialog_draft({ src: "valid" }));
  expect(state.editing.dialog_state.invalid).toBe(false);
});
