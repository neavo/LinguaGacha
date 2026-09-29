import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useQualityRuleEditing } from "./use-quality-rule-editing";
import { push_toast } from "@frontend/app/feedback/desktop-toast";

const api = vi.hoisted(() => vi.fn(async () => ({ accepted: true, changes: [] })));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: api }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    commit_project_write: (request: { run: () => Promise<unknown> }) => request.run(),
  }),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => `resolved:${key}` }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: vi.fn() }));
const entries = [{ entry_id: "original", src: "foo", info: "old" }];
let editing!: ReturnType<typeof useQualityRuleEditing<"text_preserve">>;
let root: Root | null = null;

/** 只隔离工程提交边界，重复确认和草稿生命周期使用真实实现。 */
function Probe() {
  editing = useQualityRuleEditing({
    rule_type: "text_preserve",
    project_path: "project.lg",
    entries,
    section_revision: 1,
    readonly: false,
    reorder_disabled: false,
    empty_entry: { src: "", info: "" },
    normalize: (entry) => entry,
    validate: () => null,
    selection: {
      selected_row_ids: [],
      active_row_id: null,
      anchor_row_id: null,
      set_selection_state: vi.fn(),
      restore_selection_state: vi.fn(),
      clear_selection_state: vi.fn(),
    },
    refresh: async () => undefined,
    set_result_refresh: vi.fn(),
    close_preset_menu: vi.fn(),
    export_file_name: "rules.json",
  });
  return null;
}
/** 准备新增草稿，测试从用户操作入口进入确认流程。 */
async function prepare(info: string): Promise<void> {
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(createElement(Probe));
  });
  await act(async () => editing.open_create_dialog());
  await act(async () => editing.update_dialog_draft({ src: "foo", info }));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  api.mockReset();
  api.mockResolvedValue({ accepted: true, changes: [] });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("手工重复规则取消后恢复草稿，覆盖沿用目标身份", async () => {
  await prepare("new");
  await act(async () => editing.save_dialog_entry());
  expect(editing.import_confirm_state).toMatchObject({ open: true, allow_skip: false });
  expect(api).not.toHaveBeenCalled();
  await act(async () => editing.close_import_duplicate_confirm());
  expect(editing.dialog_state).toMatchObject({
    open: true,
    draft_entry: { src: "foo", info: "new" },
  });
  await act(async () => editing.save_dialog_entry());
  await act(async () => editing.import_duplicate_overwrite());
  expect(api).toHaveBeenCalledWith("/api/quality/rules/update", {
    rule_type: "text_preserve",
    expected_section_revisions: { quality: 1 },
    entries: [expect.objectContaining({ entry_id: "original", src: "foo", info: "new" })],
  });
  expect(editing.import_confirm_state.open).toBe(false);
});

it("相同内容结束编辑且不重复提交", async () => {
  await prepare("old");
  await act(async () => editing.save_dialog_entry());
  expect(editing.import_confirm_state.open).toBe(false);
  expect(api).not.toHaveBeenCalled();
});

it.each([
  ["import", "quality_rule_editor.feedback.import_failed"],
  ["export", "quality_rule_editor.feedback.export_failed"],
  ["save", "quality_rule_editor.feedback.save_failed"],
  ["preset", "preset_editor.feedback.load_failed"],
] as const)("%s 的未知错误按操作反馈一次", async (operation, key) => {
  await prepare("new");
  vi.stubGlobal("desktopApp", {
    pickGlossaryExportPath: async () => ({ canceled: false, paths: ["rules.json"] }),
  });
  api.mockRejectedValueOnce(new Error("Unexpected failure"));
  await act(async () => {
    if (operation === "import") await editing.import_entries_from_path("rules.json");
    if (operation === "export") await editing.export_entries_from_picker();
    if (operation === "save")
      await editing.save_entries_snapshot([{ ...entries[0]!, info: "new" }]);
    if (operation === "preset") await editing.apply_preset("user:rules.json");
  });
  expect(push_toast).toHaveBeenCalledExactlyOnceWith("error", `resolved:${key}`);
});

it("已知错误码优先于导入兜底文案且只反馈一次", async () => {
  await prepare("new");
  api.mockRejectedValueOnce(
    Object.assign(new Error("Read failed"), {
      name: "DesktopApiError",
      code: "file.io_failed",
      details: {},
    }),
  );
  await act(async () => editing.import_entries_from_path("rules.json"));
  expect(push_toast).toHaveBeenCalledExactlyOnceWith(
    "error",
    "resolved:app.error.file.io_failed.message",
  );
});
