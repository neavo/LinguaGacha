import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelPage } from "./page";

const { push_toast_mock, use_model_page_state_mock } = vi.hoisted(() => ({
  push_toast_mock: vi.fn(),
  use_model_page_state_mock: vi.fn(),
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast: push_toast_mock }),
}));

vi.mock("@frontend/pages/model-page/use-model-page-state", () => ({
  useModelPageState: use_model_page_state_mock,
}));

vi.mock("@frontend/pages/model-page/components/model-item-chip", () => ({
  ModelItemChip: (props: { model: ModelEntrySnapshot; menu: ReactNode }) => (
    <article aria-label={props.model.name}>{props.menu}</article>
  ),
}));

vi.mock("@frontend/pages/model-page/dialogs/model-advanced-settings-dialog", () => ({
  ModelAdvancedSettingsDialog: (props: { onAgentLimitsAdjusted: () => void }) => (
    <button
      type="button"
      aria-label="agent-limits-adjusted"
      onClick={props.onAgentLimitsAdjusted}
    />
  ),
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
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuItem: (props: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
  AppDropdownMenuSeparator: () => <hr />,
}));

function create_model_page_state() {
  const model = create_model_snapshot({ id: "model-openai-1", name: "OpenAI 模型" });
  const open_dialog = vi.fn();

  return {
    open_dialog,
    state: {
      snapshot: { models: [model] },
      readonly: false,
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
      request_reorder_models: vi.fn(),
      request_reset_model: vi.fn(),
      request_delete_model: vi.fn(),
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

  it("配置动作携带对应类型与模型标识，且不再提供旧激活入口", async () => {
    const { open_dialog, state } = create_model_page_state();
    use_model_page_state_mock.mockReturnValue(state);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ModelPage is_sidebar_collapsed={false} />);
    });

    const find_button = (label: string): HTMLButtonElement => {
      const button = [...(container?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      if (button === undefined) {
        throw new Error(`找不到按钮：${label}`);
      }
      return button;
    };

    await act(async () => {
      find_button("model_page.action.basic_settings").click();
      find_button("model_page.action.task_settings").click();
      find_button("model_page.action.advanced_settings").click();
    });

    expect(open_dialog.mock.calls).toEqual([
      ["basic", "model-openai-1"],
      ["task", "model-openai-1"],
      ["advanced", "model-openai-1"],
    ]);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "model_page.action.activate",
      ),
    ).toBe(false);
  });

  it("Agent 最大输出自动调整时显示本地化警告", async () => {
    const { state } = create_model_page_state();
    use_model_page_state_mock.mockReturnValue(state);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ModelPage is_sidebar_collapsed={false} />);
    });

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="agent-limits-adjusted"]')
        ?.click();
    });

    expect(push_toast_mock).toHaveBeenCalledWith(
      "warning",
      "model_page.feedback.agent_limits_adjusted",
    );
  });
});
