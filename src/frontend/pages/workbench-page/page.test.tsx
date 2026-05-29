import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchPage } from "@frontend/pages/workbench-page/page";

type TaskSnapshotFixture = {
  analysis_detail_sheet_open?: boolean;
  close_analysis_detail_sheet?: () => void;
  close_translation_detail_sheet?: () => void;
  request_analysis_task_action_confirmation?: (action: string) => void;
  request_task_action_confirmation?: (action: string) => void;
  translation_detail_sheet_open?: boolean;
};

type WorkbenchStateFixture = {
  active_entry_id: string | null;
  active_workbench_task_detail: null;
  active_workbench_task_summary: null;
  active_workbench_task_view: { task_kind: string };
  analysis_stats: null;
  analysis_workbench_task: TaskSnapshotFixture;
  anchor_entry_id: string | null;
  apply_table_selection: () => void;
  can_close_project: boolean;
  can_delete_selected_files: boolean;
  can_edit_files: boolean;
  can_generate_translation: boolean;
  cancel_dialog: () => void;
  close_dialog: () => void;
  confirm_dialog: () => Promise<void>;
  consumed_revisions: Record<string, number>;
  dialog_state: null;
  entries: [];
  file_op_running: boolean;
  is_refreshing: boolean;
  notify_add_file_drop_issue: () => void;
  prepare_entry_action: () => void;
  readonly: boolean;
  request_add_file: () => Promise<void>;
  request_add_file_from_path: () => Promise<void>;
  request_add_files_from_paths: () => Promise<void>;
  request_close_project: () => void;
  request_delete_selected_files: () => void;
  request_generate_translation: () => void;
  request_reorder_entries: () => Promise<void>;
  request_reset_file: () => void;
  required_sections: string[];
  secondary_dialog: () => Promise<void>;
  selected_entry_ids: Set<string>;
  settled_project_path: string;
  stats: null;
  stats_mode: string;
  toggle_stats_mode: () => void;
  translation_stats: null;
  translation_workbench_task: TaskSnapshotFixture;
};

const {
  analysis_workbench_task,
  translation_workbench_task,
  use_workbench_page_state_mock,
  workbench_state_fixture,
}: {
  analysis_workbench_task: TaskSnapshotFixture;
  translation_workbench_task: TaskSnapshotFixture;
  use_workbench_page_state_mock: ReturnType<typeof vi.fn>;
  workbench_state_fixture: { current: WorkbenchStateFixture | null };
} = vi.hoisted(() => {
  return {
    analysis_workbench_task: {
      analysis_detail_sheet_open: false,
      close_analysis_detail_sheet: vi.fn(),
      request_analysis_task_action_confirmation: vi.fn(),
    },
    translation_workbench_task: {
      close_translation_detail_sheet: vi.fn(),
      request_task_action_confirmation: vi.fn(),
      translation_detail_sheet_open: false,
    },
    use_workbench_page_state_mock: vi.fn(),
    workbench_state_fixture: {
      current: null,
    },
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/session/workbench-tasks/workbench-tasks-session-context", () => {
  return {
    useWorkbenchTasksSession: () => ({
      analysis_workbench_task,
      translation_workbench_task,
    }),
  };
});

vi.mock("@frontend/pages/workbench-page/use-workbench-page-state", () => {
  return {
    useWorkbenchPageState: use_workbench_page_state_mock,
  };
});

vi.mock("@frontend/pages/workbench-page/components/workbench-stats-section", () => {
  return {
    WorkbenchStatsSection: () => <section data-testid="workbench-stats" />,
  };
});

vi.mock("@frontend/widgets/file-drop-zone/file-drop-zone", () => {
  return {
    FileDropZone: (props: { children: ReactNode }) => <div>{props.children}</div>,
  };
});

vi.mock("@frontend/pages/workbench-page/components/workbench-file-table", () => {
  return {
    WorkbenchFileTable: () => <div data-testid="workbench-file-table" />,
  };
});

vi.mock("@frontend/pages/workbench-page/components/workbench-command-bar", () => {
  return {
    WorkbenchCommandBar: () => <div data-testid="workbench-command-bar" />,
  };
});

vi.mock("@frontend/pages/workbench-page/components/workbench-dialogs", () => {
  return {
    WorkbenchDialogs: () => null,
  };
});

vi.mock("@frontend/pages/workbench-page/components/workbench-task-detail-sheet", () => {
  return {
    WorkbenchTaskDetailSheet: () => <aside data-testid="workbench-task-detail" />,
  };
});

// create_workbench_state_fixture 构造工作台页面壳消费的最小状态和命令句柄。
function create_workbench_state_fixture(): WorkbenchStateFixture {
  return {
    active_entry_id: null,
    active_workbench_task_detail: null,
    active_workbench_task_summary: null,
    active_workbench_task_view: {
      task_kind: "idle",
    },
    analysis_stats: null,
    analysis_workbench_task,
    anchor_entry_id: null,
    apply_table_selection: vi.fn(),
    can_close_project: true,
    can_delete_selected_files: false,
    can_edit_files: true,
    can_generate_translation: false,
    cancel_dialog: vi.fn(),
    close_dialog: vi.fn(),
    confirm_dialog: vi.fn(async () => {}),
    consumed_revisions: {
      analysis: 1,
      files: 2,
      items: 3,
    },
    dialog_state: null,
    entries: [],
    file_op_running: true,
    is_refreshing: false,
    notify_add_file_drop_issue: vi.fn(),
    prepare_entry_action: vi.fn(),
    readonly: false,
    request_add_file: vi.fn(async () => {}),
    request_add_file_from_path: vi.fn(async () => {}),
    request_add_files_from_paths: vi.fn(async () => {}),
    request_close_project: vi.fn(),
    request_delete_selected_files: vi.fn(),
    request_generate_translation: vi.fn(),
    request_reorder_entries: vi.fn(async () => {}),
    request_reset_file: vi.fn(),
    required_sections: ["project", "files", "items", "analysis"],
    secondary_dialog: vi.fn(async () => {}),
    selected_entry_ids: new Set<string>(),
    settled_project_path: "E:/demo/demo.lg",
    stats: null,
    stats_mode: "translation",
    toggle_stats_mode: vi.fn(),
    translation_stats: null,
    translation_workbench_task,
  };
}

describe("WorkbenchPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    workbench_state_fixture.current = create_workbench_state_fixture();
    use_workbench_page_state_mock.mockImplementation(() => workbench_state_fixture.current);
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    use_workbench_page_state_mock.mockReset();
  });

  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WorkbenchPage is_sidebar_collapsed={false} />);
    });
  }

  it("把任务运行态注入工作台状态", async () => {
    await mount_page();

    expect(use_workbench_page_state_mock).toHaveBeenCalledWith({
      analysisWorkbenchTask: analysis_workbench_task,
      translationWorkbenchTask: translation_workbench_task,
    });
  });
});
