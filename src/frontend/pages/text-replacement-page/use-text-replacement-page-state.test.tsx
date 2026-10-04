import { act } from "react";
import { normalize_setting_snapshot } from "@domain/setting";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectSessionUiStateProvider } from "@frontend/app/session/project-session-ui-state-provider";
import { createEmptyQualityRuleStatisticsCacheSnapshot } from "@frontend/app/session/quality-rule-statistics-store";
import { useProjectWriteCommitter } from "@frontend/app/state/desktop-project-write";
import { useTextReplacementPageState } from "./use-text-replacement-page-state";
import type { TextReplacementEntry } from "./types";

const api = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const t = (key: string) => key;
const settings = normalize_setting_snapshot({});
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: toast,
  push_toast: toast,
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

it.each(["pre", "post"] as const)(
  "%s 预设导入保留同源 literal 与 regex 身份，并刷新页面事实",
  async (variant) => {
    const original: TextReplacementEntry = {
      entry_id: "literal",
      src: "hero",
      dst: "勇者",
      regex: false,
      case_sensitive: false,
    };
    const incoming: TextReplacementEntry = {
      entry_id: "regex",
      src: "hero",
      dst: "",
      regex: true,
      case_sensitive: true,
    };
    let entries = [original];
    let revision = 2;
    api.mockReset();
    toast.mockClear();
    writes.recovery.report_state_error.mockClear();
    // 远端仅提供查询、预设与保存回执；页面查询、提交和会话状态均使用生产实现。
    api.mockImplementation(async (route: string, request: { entries?: TextReplacementEntry[] }) => {
      switch (route) {
        case "/api/quality/rules/query":
          return {
            projectPath: project.path,
            sectionRevisions: { quality: revision },
            qualityRule: { enabled: true, mode: "custom", entries, revision },
          };
        case "/api/quality/rules/presets/read":
          return { entries: [incoming] };
        case "/api/quality/rules/update":
          entries = structuredClone(request.entries!);
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
        default:
          throw new Error("Unexpected route: " + route);
      }
    });
    let state!: ReturnType<typeof useTextReplacementPageState>;
    /** 直接观察页面公开结果，异步查询由 React act 等待。 */
    function Probe() {
      state = useTextReplacementPageState(variant);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () =>
        root.render(
          <ProjectSessionUiStateProvider>
            <Probe />
          </ProjectSessionUiStateProvider>,
        ),
      );
      expect(state.entries).toEqual([original]);
      await act(async () => state.editing.apply_preset("builtin:fixture.json"));
      expect(api).toHaveBeenCalledWith("/api/quality/rules/update", {
        rule_type: variant === "pre" ? "pre_replacement" : "post_replacement",
        expected_section_revisions: { quality: 2 },
        entries: [original, incoming],
      });
      expect(state.editing.import_confirm_state.open).toBe(false);
      expect(state.entries).toEqual([original, incoming]);
      expect(toast).not.toHaveBeenCalled();
      expect(writes.recovery.report_state_error).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  },
);
