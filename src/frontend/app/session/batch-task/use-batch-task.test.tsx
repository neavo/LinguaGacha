import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  create_batch_task_snapshot,
  type BatchTaskListSnapshot,
  type BatchTaskSnapshot,
} from "@domain/batch-task";
import { empty_batch_task_list_snapshot, read_batch_task_list_snapshot } from "@shared/batch-task";
import { create_text_resolver } from "@shared/i18n";
import { createBatchTaskSnapshotStore } from "@frontend/app/state/batch-task-snapshot-store";
import type { ProjectWriteCommitRequest } from "@frontend/app/state/desktop-project-write";
import { useBatchTask } from "./use-batch-task";
import { TASK_WAVEFORM_SAMPLE_INTERVAL_MS } from "./batch-task-waveform-state";

const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn(), toast: vi.fn(), export: vi.fn() }));
const t = create_text_resolver("zh-CN");
let root: Root;
let store: ReturnType<typeof createBatchTaskSnapshotStore>;
let active_project: {
  batch_task: typeof store;
  update_task: (payload: Record<string, unknown>) => void;
};
let state: ReturnType<typeof useBatchTask>;
let revision: number;
const commit = vi.fn(async ({ run }: ProjectWriteCommitRequest) => run());
vi.mock("@frontend/app/state/use-project-fetch", () => ({ useProjectFetch: () => mocks.api }));
vi.mock("@frontend/app/state/use-project-runtime", () => ({
  useProjectRuntimeSnapshot: () => ({ owner: null }),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t }) }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.error,
  push_toast: mocks.toast,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    active_project,
    project_snapshot: { loaded: true },
    commit_project_write: commit,
  }),
  useBatchTaskSnapshot: () => useSyncExternalStore(store.subscribe, store.getSnapshot),
}));

function Probe() {
  state = useBatchTask({ onRequestExport: mocks.export });
  return null;
}

function snapshot(tasks: readonly BatchTaskSnapshot[], output_tokens = 0): BatchTaskListSnapshot {
  return {
    ...empty_batch_task_list_snapshot(),
    project_path: "project.lg",
    revision: ++revision,
    activity:
      tasks[0] === undefined
        ? null
        : {
            id: tasks[0].run_id,
            start_time: 0,
            usage: { input_tokens: 0, reasoning_tokens: 0, output_tokens },
          },
    tasks,
  };
}

const translation = {
  ...create_batch_task_snapshot("translation", "translation", "standalone"),
  status: "running",
  translation: { operation: "translate", pending_item_ids: [] },
} as const;
const request = {
  ...create_batch_task_snapshot("request", "request", "agent"),
  status: "running",
} as const;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockReset();
  root = createRoot(document.createElement("div"));
  store = createBatchTaskSnapshotStore();
  revision = 0;
  active_project = {
    batch_task: store,
    update_task: (payload) => store.applySnapshot(read_batch_task_list_snapshot(payload)),
  };
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it("请求期间仍可启动翻译，并行采样连续，空闲和新一轮清空速度", async () => {
  vi.useFakeTimers();
  await act(async () => store.applySnapshot(snapshot([request])));
  expect(state.translation_action_blocked).toBe(false);
  const mixed = snapshot([request, translation], (50 * TASK_WAVEFORM_SAMPLE_INTERVAL_MS) / 1_000);
  mocks.api.mockResolvedValueOnce({ batch_tasks: mixed });
  await act(async () => state.request_start_translation());
  expect(mocks.api).toHaveBeenCalledWith("/api/batch-translation/start", {
    operation: "translate",
    scope: { kind: "all" },
  });
  await act(async () => vi.advanceTimersByTimeAsync(TASK_WAVEFORM_SAMPLE_INTERVAL_MS));
  expect(state.summary).toMatchObject({ status_text: "正在处理批量任务", speed_text: "50.00 T/s" });
  expect(state.metrics.completion_percent).toBeNull();
  expect(state.task_waveform_history.at(-1)).toBe(50);
  await act(async () => store.applySnapshot(snapshot([])));
  expect(state.summary).toMatchObject({ status_text: "无任务", speed_text: null });
  expect(state.task_waveform_history).toEqual([]);
  const next = { ...translation, run_id: "next" };
  await act(async () => store.applySnapshot(snapshot([next])));
  expect(state.summary.speed_text).toBe("0.00 T/s");
  expect(state.task_waveform_history).toEqual([0]);
});

it("停止确认固定打开时的批次并经工程 Store 应用回包", async () => {
  await act(async () => store.applySnapshot(snapshot([translation, request])));
  await act(async () => state.request_task_action_confirmation("stop"));
  const next = { ...request, run_id: "next" };
  await act(async () => store.applySnapshot(snapshot([translation, request, next])));
  const stopping = snapshot([
    { ...translation, status: "stopping" },
    { ...request, status: "stopping" },
    next,
  ]);
  mocks.api.mockResolvedValueOnce({ batch_tasks: stopping });
  await act(async () => state.confirm_task_action());
  expect(mocks.api).toHaveBeenCalledWith("/api/batch-task/stop", {
    run_ids: ["translation", "request"],
  });
  expect(store.getSnapshot()).toEqual(stopping);
  expect(state.task_confirm_state).toBeNull();
});

it.each([
  ["translate", "done", 0, "success", true],
  ["retranslate", "done", 3, "warning", false],
  ["translate", "stopped", 0, "info", false],
] as const)("独立翻译 %s %s 按回执通知一次", async (operation, status, failed, tone, exports) => {
  await act(async () => store.applySnapshot(snapshot([translation])));
  const finished = {
    ...snapshot([]),
    last_translation: { run_id: translation.run_id, operation, status, failed },
  };
  await act(async () => store.applySnapshot(finished));
  await act(async () => store.applySnapshot({ ...finished, revision: finished.revision + 1 }));
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(mocks.toast.mock.calls[0]?.[0]).toBe(tone);
  expect(mocks.export).toHaveBeenCalledTimes(exports ? 1 : 0);
});

it("清空译文走工程写入并消费提交结果", async () => {
  const payload = { accepted: true };
  mocks.api.mockResolvedValueOnce(payload);
  await act(async () => state.request_task_action_confirmation("reset-all"));
  await act(async () => state.confirm_task_action());
  expect(mocks.api).toHaveBeenCalledWith("/api/workbench/translation/reset", { mode: "all" });
  expect(commit).toHaveBeenCalledOnce();
  expect(state.task_confirm_state).toBeNull();
});
