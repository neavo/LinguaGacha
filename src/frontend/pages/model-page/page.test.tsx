import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelPage } from "./page";

const { push_toast_mock, use_model_page_state_mock } = vi.hoisted(() => ({
  push_toast_mock: vi.fn(),
  use_model_page_state_mock: vi.fn(),
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast_mock,
  push_toast: push_toast_mock,
}));

vi.mock("@frontend/pages/model-page/use-model-page-state", () => ({
  useModelPageState: use_model_page_state_mock,
}));

vi.mock("@frontend/pages/model-page/dialogs/model-advanced-settings-dialog", () => ({
  ModelAdvancedSettingsDialog: () => null,
}));

vi.mock("@frontend/pages/model-page/dialogs/model-basic-settings-dialog", () => ({
  ModelBasicSettingsDialog: () => null,
}));

vi.mock("@frontend/pages/model-page/dialogs/model-selector-dialog", () => ({
  ModelSelectorDialog: () => null,
}));

vi.mock("@frontend/pages/model-page/dialogs/model-task-settings-dialog", () => ({
  ModelTaskSettingsDialog: () => null,
}));

vi.mock("@frontend/widgets/app-alert-dialog", () => ({
  AppConfirmDialog: () => null,
  AppActionDialog: () => null,
}));

/** 隔离页面动作分发，交互效果由对应 Hook 测试负责。 */
function create_model_page_state() {
  const model = create_model_snapshot({ id: "model-openai-1", name: "OpenAI 模型" });
  const open_dialog = vi.fn();

  return {
    open_dialog,
    state: {
      load_status: "ready",
      refresh_snapshot: vi.fn(),
      snapshot: { models: [model] },
      readonly: false,
      test_disabled: false,
      grouped_categories: [
        {
          type: "PRESET",
          title: "预设模型",
          description: "预设模型说明",
          accent_color: "blue",
          can_add: false,
          models: [model],
        },
      ],
      dialog_state: { kind: null, model_id: null },
      active_dialog_model: null,
      selector_state: {
        open: false,
        model_id: null,
        available_models: [],
        filter_text: "",
        is_loading: false,
      },
      confirm_state: { kind: null, model_id: null },
      open_dialog,
      close_dialog: vi.fn(),
      update_model_patch: vi.fn(),
      open_selector_dialog: vi.fn(),
      request_test_model: vi.fn(),
      set_selector_filter_text: vi.fn(),
      load_available_models: vi.fn(),
      select_model_id: vi.fn(),
      close_selector_dialog: vi.fn(),
      confirm_dialog: vi.fn(),
      close_confirm: vi.fn(),
      request_add_model: vi.fn(),
      request_copy_model: vi.fn(),
      request_reorder_models: vi.fn(),
      request_reset_model: vi.fn(),
      request_delete_model: vi.fn(),
      request_logout: vi.fn(),
    },
  };
}

describe("ModelPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    use_model_page_state_mock.mockReset();
    push_toast_mock.mockReset();
  });

  it("菜单动作提交所在条目的模型 ID", async () => {
    const { open_dialog, state } = create_model_page_state();
    const other = create_model_snapshot({ id: "other", name: "另一个模型", can_reset: false });
    state.snapshot.models.push(other);
    state.grouped_categories[0]!.models.push(other);
    use_model_page_state_mock.mockReturnValue(state);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ModelPage is_sidebar_collapsed={false} />);
    });

    /** 打开实际条目菜单，验证页面绑定的目标身份。 */
    async function select(model_name: string, label: string): Promise<void> {
      const trigger = [...container!.querySelectorAll("button")].find(
        (button) => button.textContent === model_name,
      )!;
      await act(async () => trigger.click());
      const menu = document.querySelector('[role="menu"][data-open]')!;
      const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === label,
      )!;
      await act(async () => item.click());
    }
    await select("OpenAI 模型", "model_page.action.reset");
    await select("另一个模型", "model_page.action.delete");
    await select("另一个模型", "model_page.action.copy");
    await select("另一个模型", "model_page.action.basic_settings");

    expect(state.request_reset_model).toHaveBeenCalledExactlyOnceWith("model-openai-1");
    expect(state.request_delete_model).toHaveBeenCalledExactlyOnceWith("other");
    expect(state.request_copy_model).toHaveBeenCalledExactlyOnceWith("other");
    expect(open_dialog).toHaveBeenCalledExactlyOnceWith("basic", "other");
  });
});
