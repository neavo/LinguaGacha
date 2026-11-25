import { describe, expect, it } from "vitest";
import { batch_task_metrics } from "@shared/batch-task";
import { create_batch_task_snapshot, empty_batch_task_progress } from "@domain/batch-task";
import {
  build_batch_task_switcher_items,
  build_translation_task_detail_display,
  build_batch_task_summary_display,
} from "./batch-task-display";
import type { useI18n } from "@frontend/app/locale/locale-context";
const t: ReturnType<typeof useI18n>["t"] = (key) => key;
describe("批量任务展示", () => {
  it("详情按本轮成功与失败计算进度，时间与速度使用同轮数据", () => {
    const metrics = batch_task_metrics(
      {
        ...create_batch_task_snapshot("fixture", "translation", "standalone"),
        status: "stopped",
        progress: {
          ...empty_batch_task_progress("item", 4),
          succeeded: 2,
          failed: 1,
          time: 87864.8,
          output_tokens: 878648,
        },
      },
      100000,
    );
    const detail = build_translation_task_detail_display({
      metrics,
      waveform_history: [],
      t,
    });
    expect(detail.completion_percent_text).toBe("75.00%");
    expect(detail.metric_entries).toContainEqual(
      expect.objectContaining({
        key: "elapsed",
        value_text: "24:24:24",
        unit_text: "",
      }),
    );
    const speed = detail.metric_entries.find((entry) => entry.key === "speed")!;
    const summary = build_batch_task_summary_display({
      metrics: { ...metrics, active: true },
      kind: null,
      t,
    });
    expect(summary.speed_text).toBe(`${speed.value_text} ${speed.unit_text}`);
    expect(detail.stop_disabled).toBe(true);
  });

  it("停止中保留速度，空闲时收起运行指标", () => {
    const metrics = {
      ...batch_task_metrics(null, 0),
      active: true,
      stopping: true,
    };
    const summary = build_batch_task_summary_display({ metrics, kind: null, t });
    expect(summary.speed_text).not.toBeNull();
    expect(
      build_batch_task_summary_display({
        metrics: { ...metrics, active: false, stopping: false },
        kind: null,
        t,
      }).speed_text,
    ).toBeNull();
  });

  it("多活跃任务摘要附带数量，切换项为同类多批次追加序号区分", () => {
    const translation = {
      ...create_batch_task_snapshot("run-tr", "translation", "standalone"),
      status: "running" as const,
      progress: { ...empty_batch_task_progress("item", 4), succeeded: 1 },
    };
    const request_a = {
      ...create_batch_task_snapshot("run-req-1", "request", "agent"),
      status: "running" as const,
      progress: { ...empty_batch_task_progress("request", 2), succeeded: 1 },
    };
    const request_b = {
      ...create_batch_task_snapshot("run-req-2", "request", "agent"),
      status: "done" as const,
      progress: null,
    };

    const single_summary = build_batch_task_summary_display({
      metrics: batch_task_metrics(translation, 10),
      kind: "translation",
      active_task_count: 1,
      t,
    });
    expect(single_summary.status_text).toBe("batch_translation.summary.translation.running");

    const multi_summary = build_batch_task_summary_display({
      metrics: batch_task_metrics(translation, 10),
      kind: "translation",
      active_task_count: 2,
      t,
    });
    expect(multi_summary.status_text).toBe("batch_translation.summary.translation.running (2)");

    expect(
      build_batch_task_switcher_items({
        tasks: [translation, request_a],
        selected_run_id: "run-req-1",
        t,
      }),
    ).toEqual([
      {
        run_id: "run-tr",
        label: "batch_translation.kind.translation",
        progress_text: "25.00%",
        selected: false,
        status: "running",
      },
      {
        run_id: "run-req-1",
        label: "batch_translation.kind.request",
        progress_text: "50.00%",
        selected: true,
        status: "running",
      },
    ]);

    expect(
      build_batch_task_switcher_items({
        tasks: [translation, request_a, request_b],
        selected_run_id: "run-tr",
        t,
      }).map(({ label, progress_text }) => ({ label, progress_text })),
    ).toEqual([
      { label: "batch_translation.kind.translation", progress_text: "25.00%" },
      { label: "batch_translation.kind.request #1", progress_text: "50.00%" },
      { label: "batch_translation.kind.request #2", progress_text: null },
    ]);
  });
});
