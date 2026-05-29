import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { TaskSnapshot } from "@frontend/app/state/task-snapshot-store";
import type { ProofreadingCommandPlan } from "@shared/proofreading/proofreading-command-planner";
import { useProofreadingBatchActions } from "@frontend/pages/proofreading-page/use-proofreading-batch-actions";
import type { ProjectItemPublicRecord } from "@domain/item";
import type { ProjectDataSectionRevisions } from "@shared/project-event";

type BatchActionState = ReturnType<typeof useProofreadingBatchActions>;

type WriteCall = {
  path: string;
  plan: ProofreadingCommandPlan | null;
  fallback_error_key: string;
  preferred_row_id?: string | null;
  success_message_builder?: ((changed_count: number) => string) | null;
  empty_warning_message?: string | null;
  close_dialog?: boolean;
};

type HookFixture = {
  readonly: boolean;
  is_refreshing: boolean;
  is_writing: boolean;
  dialog_open: boolean;
  section_revisions: ProjectDataSectionRevisions;
  read_items_by_row_ids: ReturnType<
    typeof vi.fn<(row_ids: string[]) => Promise<ProjectItemPublicRecord[]>>
  >;
  task_snapshot: TaskSnapshot;
  proofreading_revision: number;
  sync_task_snapshot: ReturnType<typeof vi.fn<(snapshot: TaskSnapshot) => void>>;
  run_project_write: ReturnType<typeof vi.fn<(_args: WriteCall) => Promise<void>>>;
  set_is_writing: ReturnType<typeof vi.fn<(next_is_writing: boolean) => void>>;
  resolve_preferred_row_id: ReturnType<
    typeof vi.fn<(preferred_row_id?: string | null) => string | null>
  >;
  remember_preferred_row_id: ReturnType<typeof vi.fn<(preferred_row_id: string | null) => void>>;
  close_edit_dialog: ReturnType<typeof vi.fn<() => void>>;
  handle_api_error: ReturnType<typeof vi.fn<(error: unknown, fallback_message: string) => void>>;
  write_calls: WriteCall[];
  t: (key: string) => string;
};

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

// create_project_item 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
function create_project_item(
  overrides: Partial<ProjectItemPublicRecord> = {},
): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "源文",
    dst: "译文",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 1,
    file_type: "TXT",
    file_path: "chapter.txt",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

// create_task_snapshot 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
function create_task_snapshot(): TaskSnapshot {
  return {
    run_revision: 3,
    task_type: "translation",
    status: "idle",
    busy: false,
    request_in_flight_count: 0,
    progress: {
      line: 0,
      total_line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
    },
    extras: {
      kind: "translation",
      scope: {
        kind: "all",
      },
    },
  };
}

// create_hook_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
function create_hook_fixture(): HookFixture {
  const write_calls: WriteCall[] = [];
  return {
    readonly: false,
    is_refreshing: false,
    is_writing: false,
    dialog_open: false,
    section_revisions: {
      items: 7,
      quality: 3,
      prompts: 4,
      proofreading: 5,
    },
    read_items_by_row_ids: vi.fn(async (row_ids: string[]) => {
      const items_by_row_id = new Map([
        ["1", create_project_item()],
        [
          "2",
          create_project_item({
            item_id: 2,
            dst: "第二条译文",
            status: "ERROR",
            retry_count: 1,
          }),
        ],
      ]);
      return row_ids.flatMap((row_id) => {
        const item = items_by_row_id.get(row_id);
        return item === undefined ? [] : [item];
      });
    }),
    task_snapshot: create_task_snapshot(),
    proofreading_revision: 5,
    sync_task_snapshot: vi.fn((_snapshot: TaskSnapshot) => undefined),
    run_project_write: vi.fn(async (args: WriteCall) => {
      write_calls.push(args);
    }),
    set_is_writing: vi.fn((_next_is_writing: boolean) => undefined),
    resolve_preferred_row_id: vi.fn((preferred_row_id?: string | null) => {
      return preferred_row_id ?? "1";
    }),
    remember_preferred_row_id: vi.fn((_preferred_row_id: string | null) => undefined),
    close_edit_dialog: vi.fn(() => undefined),
    handle_api_error: vi.fn((_error: unknown, _fallback_message: string) => undefined),
    write_calls,
    t: (key: string) => key,
  };
}

describe("useProofreadingBatchActions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: BatchActionState | null = null;
  let fixture = create_hook_fixture();

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    fixture = create_hook_fixture();
    vi.mocked(api_fetch).mockReset();
  });

  // BatchActionProbe 收口测试中的共享步骤，保证断言只关注当前行为。
  function BatchActionProbe(): null {
    latest_state = useProofreadingBatchActions(fixture);
    return null;
  }

  // render_hook 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 生成当前场景的展示内容。
   */
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(BatchActionProbe));
    });
  }

  // flush_async_updates 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("请求重翻时只打开确认状态，不直接启动任务", async () => {
    await render_hook();

    await act(async () => {
      latest_state?.request_retranslate_row_ids(["2", "1"], "2");
    });

    expect(latest_state?.pending_confirmation).toMatchObject({
      kind: "retranslate",
      target_row_ids: ["2", "1"],
      preferred_row_id: "2",
      submitting: false,
    });
    expect(api_fetch).not.toHaveBeenCalled();
  });

  it("只读状态会忽略批量动作请求", async () => {
    fixture = {
      ...fixture,
      readonly: true,
    };
    await render_hook();

    await act(async () => {
      latest_state?.request_retranslate_row_ids(["1"], "1");
      latest_state?.request_set_translation_status_row_ids(["1"], "PROCESSED", "1");
    });
    await flush_async_updates();

    expect(latest_state?.pending_confirmation).toBeNull();
    expect(api_fetch).not.toHaveBeenCalled();
    expect(fixture.write_calls).toEqual([]);
  });

  it("确认重翻时启动指定条目任务并补齐运行态快照", async () => {
    await render_hook();
    vi.mocked(api_fetch).mockResolvedValueOnce({
      task: {
        run_revision: 9,
        status: "requested",
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [2, 1],
          },
        },
      },
    });

    await act(async () => {
      latest_state?.request_retranslate_row_ids(["2", "1", "2"], "2");
    });
    await act(async () => {
      await latest_state?.confirm_pending_confirmation();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/tasks/start", {
      task_type: "translation",
      mode: "new",
      scope: {
        kind: "items",
        item_ids: [2, 1],
      },
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
        quality: 3,
        prompts: 4,
      },
    });
    expect(fixture.remember_preferred_row_id).toHaveBeenCalledWith("2");
    expect(fixture.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        run_revision: 9,
        task_type: "translation",
        status: "requested",
        busy: true,
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [2, 1],
          },
        },
      }),
    );
    expect(latest_state?.pending_confirmation).toBeNull();
  });

  it("确认清空译文时提交目标条目和 revision 锁", async () => {
    await render_hook();

    await act(async () => {
      latest_state?.request_clear_translation_row_ids(["1"], "1");
    });

    expect(latest_state?.pending_confirmation).toMatchObject({
      kind: "clear-translations",
      target_row_ids: ["1"],
      preferred_row_id: "1",
      submitting: false,
    });

    await act(async () => {
      await latest_state?.confirm_pending_confirmation();
    });

    expect(fixture.write_calls).toHaveLength(1);
    expect(fixture.write_calls[0]).toMatchObject({
      path: "/api/proofreading/translations/clear",
      fallback_error_key: "proofreading_page.feedback.clear_translation_failed",
      preferred_row_id: "1",
      close_dialog: false,
    });
    expect(fixture.write_calls[0]?.plan?.request_body).toMatchObject({
      item_ids: [1],
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
      },
    });
    expect(latest_state?.pending_confirmation).toBeNull();
  });

  it("设置翻译状态时直接提交 write，不进入确认状态", async () => {
    await render_hook();

    await act(async () => {
      latest_state?.request_set_translation_status_row_ids(["2"], "PROCESSED", "2");
    });
    await flush_async_updates();

    expect(latest_state?.pending_confirmation).toBeNull();
    expect(fixture.write_calls).toHaveLength(1);
    const write_call = fixture.write_calls[0];
    expect(write_call).toMatchObject({
      path: "/api/proofreading/items/set-status",
      fallback_error_key: "proofreading_page.feedback.set_status_failed",
      preferred_row_id: "2",
      close_dialog: false,
    });
    expect(write_call?.plan?.request_body).toMatchObject({
      item_ids: [2],
      status: "PROCESSED",
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
      },
    });
  });
});
