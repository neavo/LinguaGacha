import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessageInput } from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { WorkbenchCommandBar } from "./workbench-command-bar";

/** 只替换命令栏跨页面协作者，任务菜单仍通过公开启动回调驱动。 */
const navigation_mocks = vi.hoisted(() => ({ navigate_to_route: vi.fn() }));
const toast_mocks = vi.hoisted(() => ({ push_toast: vi.fn() }));
const agent_input_mocks = vi.hoisted(() => ({
  draft: { text: "", attachments: [] } as AgentMessageInput,
  read_draft: vi.fn(),
  write_draft: vi.fn<(draft: AgentMessageInput) => void>(),
}));

/** 测试只关心 i18n 键的消费关系，不复制可独立调整的产品文案。 */
const locale_messages: Record<string, string> = {
  "workbench_page.analysis_task.feedback.agent_draft_preserved": "draft-preserved",
};

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => locale_messages[key] ?? key,
  }),
}));

vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => navigation_mocks,
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => toast_mocks,
}));

vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentInput: () => agent_input_mocks,
}));

vi.mock("@frontend/pages/workbench-page/components/workbench-task-menu", () => ({
  WorkbenchTaskMenu: (props: {
    task_kind: "translation" | "analysis";
    model_selection: unknown;
    on_start_or_continue: () => Promise<void>;
  }) => (
    <button
      type="button"
      data-model-selection={props.model_selection !== undefined}
      onClick={() => {
        void props.on_start_or_continue();
      }}
    >
      {props.task_kind}-task
    </button>
  ),
}));

/** 构造命令栏公开契约所需的最小完整状态。 */
function create_workbench_command_bar_props(): ComponentProps<typeof WorkbenchCommandBar> {
  const stats = {
    total_items: 4,
    completed_count: 1,
    failed_count: 0,
    pending_count: 3,
    skipped_count: 0,
    completion_percent: 25,
  };
  const translation_task_metrics = {
    active: false,
    stopping: false,
    processed_count: 0,
    failed_count: 0,
    elapsed_seconds: 0,
    remaining_seconds: 0,
    average_generation_speed: 0,
    input_tokens: 0,
    reasoning_tokens: 0,
    output_tokens: 0,
    request_in_flight_count: 0,
    completion_percent: 0,
  };
  const analysis_task_metrics = {
    ...translation_task_metrics,
    candidate_count: 0,
  };

  return {
    translation_workbench_task: {
      translation_task_display_snapshot: null,
      translation_task_metrics,
      translation_waveform_history: [],
      translation_detail_sheet_open: false,
      task_confirm_state: null,
      translation_task_menu_disabled: false,
      translation_task_menu_busy: false,
      open_translation_detail_sheet: () => {},
      close_translation_detail_sheet: () => {},
      request_start_or_continue_translation: vi.fn(async () => {}),
      request_task_action_confirmation: () => {},
      confirm_task_action: async () => {},
      close_task_action_confirmation: () => {},
    },
    analysis_workbench_task: {
      analysis_task_display_snapshot: null,
      analysis_task_metrics,
      analysis_waveform_history: [],
      analysis_detail_sheet_open: false,
      analysis_confirm_state: null,
      analysis_import_confirm_state: {
        open: false,
        duplicate_count: 0,
        submitting: false,
      },
      analysis_importing: false,
      analysis_task_menu_disabled: false,
      analysis_task_menu_busy: false,
      open_analysis_detail_sheet: () => {},
      close_analysis_detail_sheet: () => {},
      request_start_or_continue_analysis: vi.fn(async () => {}),
      request_analysis_task_action_confirmation: () => {},
      confirm_analysis_task_action: async () => {},
      close_analysis_task_action_confirmation: () => {},
      import_analysis_glossary_duplicate_skip: async () => {},
      import_analysis_glossary_duplicate_overwrite: async () => {},
      close_analysis_glossary_import_confirmation: () => {},
      refresh_analysis_task_snapshot: async () => {},
    },
    active_workbench_task_view: {
      task_kind: null,
      can_open_detail: false,
    },
    active_workbench_task_summary: {
      status_text: "idle",
      trailing_text: null,
      tone: "neutral",
      show_spinner: false,
      detail_tooltip_text: "idle",
    },
    translation_stats: stats,
    analysis_stats: stats,
    can_edit_files: true,
    can_delete_selected_files: true,
    can_generate_translation: true,
    can_close_project: true,
    on_add_file: () => {},
    on_delete_selected: () => {},
    on_generate_translation: () => {},
    on_close_project: () => {},
  };
}

describe("WorkbenchCommandBar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    navigation_mocks.navigate_to_route.mockReset();
    toast_mocks.push_toast.mockReset();
    agent_input_mocks.draft = { text: "", attachments: [] };
    agent_input_mocks.read_draft.mockReset();
    agent_input_mocks.read_draft.mockImplementation(() => agent_input_mocks.draft);
    agent_input_mocks.write_draft.mockReset();
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 使用真实 DOM 渲染命令栏与弹窗，只替换跨页面协作者。 */
  async function render_command_bar(
    props = create_workbench_command_bar_props(),
  ): Promise<ComponentProps<typeof WorkbenchCommandBar>> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TooltipProvider>
          <WorkbenchCommandBar {...props} />
        </TooltipProvider>,
      );
    });
    return props;
  }

  /** 按用户可见名称定位按钮，避免依赖组件内部层级。 */
  function find_button(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (button === undefined) throw new Error(`找不到按钮：${label}`);
    return button;
  }

  /** 从共享动作弹窗读取指定语义按钮。 */
  function find_dialog_button(
    slot: "cancel" | "secondary-action" | "primary-action",
  ): HTMLButtonElement {
    const button = document.body.querySelector<HTMLButtonElement>(
      `[data-slot="alert-dialog-${slot}"]`,
    );
    if (button === null) throw new Error(`找不到弹窗按钮：${slot}`);
    return button;
  }

  it("删除按钮只消费上游删除权限", async () => {
    const props = create_workbench_command_bar_props();
    props.can_delete_selected_files = false;
    await render_command_bar(props);

    expect(find_button("app.action.delete").disabled).toBe(true);
  });

  it("每次启动经典分析都先提醒，继续后才调用原任务入口", async () => {
    const props = await render_command_bar();
    const start_analysis = props.analysis_workbench_task.request_start_or_continue_analysis;

    await act(async () => find_button("analysis-task").click());
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    expect(start_analysis).not.toHaveBeenCalled();

    await act(async () => find_dialog_button("primary-action").click());
    expect(start_analysis).toHaveBeenCalledOnce();

    await act(async () => find_button("analysis-task").click());
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
  });

  it("取消迁移提醒后不启动任务或跳转", async () => {
    const props = await render_command_bar();

    await act(async () => find_button("analysis-task").click());
    await act(async () => find_dialog_button("cancel").click());

    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    expect(props.analysis_workbench_task.request_start_or_continue_analysis).not.toHaveBeenCalled();
    expect(agent_input_mocks.write_draft).not.toHaveBeenCalled();
    expect(navigation_mocks.navigate_to_route).not.toHaveBeenCalled();
  });

  it("跳转 AGENT 前为当前空草稿写入质量规则任务", async () => {
    const props = await render_command_bar();

    await act(async () => find_button("analysis-task").click());
    await act(async () => find_dialog_button("secondary-action").click());

    expect(agent_input_mocks.write_draft).toHaveBeenCalledOnce();
    const written_draft = agent_input_mocks.write_draft.mock.calls[0]?.[0];
    expect(written_draft?.text.trim()).not.toBe("");
    expect(written_draft?.attachments).toEqual([]);
    expect(navigation_mocks.navigate_to_route).toHaveBeenCalledWith("agent");
    expect(props.analysis_workbench_task.request_start_or_continue_analysis).not.toHaveBeenCalled();
  });

  it("已有 AGENT 草稿时保留原内容并提示后跳转", async () => {
    agent_input_mocks.draft = {
      text: "已有任务",
      attachments: [{ kind: "image", webpBase64: "webp-image" }],
    };
    await render_command_bar();

    await act(async () => find_button("analysis-task").click());
    await act(async () => find_dialog_button("secondary-action").click());

    expect(agent_input_mocks.write_draft).not.toHaveBeenCalled();
    expect(toast_mocks.push_toast).toHaveBeenCalledWith("info", "draft-preserved");
    expect(navigation_mocks.navigate_to_route).toHaveBeenCalledWith("agent");
  });

  it("翻译任务仍直接进入原启动入口", async () => {
    const props = await render_command_bar();

    await act(async () => find_button("translation-task").click());

    expect(
      props.translation_workbench_task.request_start_or_continue_translation,
    ).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });
});
