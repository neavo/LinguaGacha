import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchPage } from "./page";

const state = vi.hoisted(() => ({
  workbench: {
    entries: [] as { file_type: string; progress: { total_count: number } }[],
    cache_status: "ready",
    readonly: false,
    settled_project_path: "project.lg",
    godot_pack_order: { dialog_props: {} },
    game_backup_confirm: { dialog_props: {} },
  },
  task: {
    translation_task_menu_disabled: false,
    request_start_or_continue_translation: vi.fn(async () => {}),
  },
  navigate_to_agent: vi.fn(),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: state.navigate_to_agent }),
}));
vi.mock("@frontend/app/session/batch-translation/batch-translation-session-context", () => ({
  useBatchTranslationSession: () => ({ batch_translation_task: state.task }),
}));
vi.mock("@frontend/app/session/translation-generation/translation-generation-context", () => ({
  useTranslationGeneration: () => ({}),
}));
vi.mock("@frontend/app/session/project-translation-stats-context", () => ({
  useProjectTranslationStats: () => ({ total_items: 0 }),
}));
vi.mock("./use-workbench-page-state", () => ({ useWorkbenchPageState: () => state.workbench }));
vi.mock("./components/workbench-command-bar", () => ({
  WorkbenchCommandBar: (props: {
    can_start_translation: boolean;
    on_request_start_translation: () => void;
  }) => (
    <button disabled={!props.can_start_translation} onClick={props.on_request_start_translation}>
      start
    </button>
  ),
}));
vi.mock("./components/workbench-file-table", () => ({ WorkbenchFileTable: () => null }));
vi.mock("./components/workbench-stats-section", () => ({ WorkbenchStatsSection: () => null }));
vi.mock("./components/workbench-dialogs", () => ({ WorkbenchDialogs: () => null }));
vi.mock("@frontend/features/godot-pack-order/godot-pack-order-dialog", () => ({
  GodotPackOrderDialog: () => null,
}));
vi.mock("@frontend/widgets/file-drop-zone/file-drop-zone", () => ({
  FileDropZone: (props: { children: ReactNode }) => props.children,
}));

describe("WorkbenchPage translation entry", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    state.workbench.entries = [{ file_type: "TXT", progress: { total_count: 1 } }];
    state.workbench.cache_status = "ready";
    state.workbench.readonly = false;
    state.workbench.settled_project_path = "project.lg";
    state.task.translation_task_menu_disabled = false;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 保留页面实例，验证刷新与工程切换后的弹窗寿命。 */
  async function render(): Promise<void> {
    await act(async () => root.render(<WorkbenchPage />));
  }
  /** 从可见动作触发业务，弹窗通过 Portal 挂载到 body。 */
  async function click(label: string): Promise<void> {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
      element.textContent?.includes(label),
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }
  it.each(["TXT", "RPGMAKER_MV_MZ"])("%s 允许直接翻译，取消不启动任务", async (file_type) => {
    state.workbench.entries[0]!.file_type = file_type;
    await render();
    await click("start");
    expect(state.task.request_start_or_continue_translation).not.toHaveBeenCalled();

    await click("app.action.cancel");
    expect(state.task.request_start_or_continue_translation).not.toHaveBeenCalled();
    await click("start");
    await click("translate_directly");
    expect(state.task.request_start_or_continue_translation).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it.each(["PDF", "GENERIC"])(
    "%s 无文本条目也能转交，混合工程同样禁止直接翻译",
    async (file_type) => {
      state.workbench.entries = [{ file_type, progress: { total_count: 0 } }];
      await render();
      await click("start");

      expect(document.body.textContent).not.toContain("translate_directly");
      await click("app.action.handle_with_agent");
      expect(state.navigate_to_agent).toHaveBeenCalledExactlyOnceWith({
        text: 'agent_page.empty.suggestions.translate_full_text @skill("translation")',
      });
      expect(state.task.request_start_or_continue_translation).not.toHaveBeenCalled();
      state.workbench.entries.push({ file_type: "TXT", progress: { total_count: 5 } });
      await render();
      await click("start");
      expect(document.body.textContent).not.toContain("translate_directly");
    },
  );
  it("快照未就绪、空工程或运行占用时不能启动，刷新和切换工程清除旧选择", async () => {
    for (const cache_status of ["idle", "refreshing", "error"]) {
      state.workbench.cache_status = cache_status;
      await render();
      expect(container.querySelector("button")!.disabled).toBe(true);
    }
    state.workbench.cache_status = "ready";
    state.workbench.entries = [];
    await render();
    expect(container.querySelector("button")!.disabled).toBe(true);
    state.workbench.entries = [{ file_type: "TXT", progress: { total_count: 1 } }];
    state.workbench.readonly = true; // 文件写入也会禁用入口，独立于翻译运行占用。
    await render();
    expect(container.querySelector("button")!.disabled).toBe(true);
    state.workbench.readonly = false;
    state.task.translation_task_menu_disabled = true;
    await render();
    expect(container.querySelector("button")!.disabled).toBe(true);
    state.task.translation_task_menu_disabled = false;
    await render();
    await click("start");
    state.workbench.cache_status = "refreshing";
    await render();
    state.workbench.cache_status = "ready";
    await render();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await click("start");
    state.workbench.settled_project_path = "other.lg";
    await render();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
