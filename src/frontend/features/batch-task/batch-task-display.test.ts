import { describe, expect, it } from "vitest";
import { batch_task_metrics, empty_batch_task_snapshot } from "@shared/batch-task";
import { empty_batch_task_progress } from "@domain/batch-task";
import {
  build_translation_task_detail_display,
  build_batch_task_summary_display,
} from "./batch-task-display";
import type { useI18n } from "@frontend/app/locale/locale-context";
const t: ReturnType<typeof useI18n>["t"] = (key) => key;
describe("批量任务展示", () => {
  it.each(["translation", "request", null] as const)("%s 按任务类型展示运行和停止状态", (kind) => {
    for (const [status, suffix] of [
      ["requested", kind === null ? "running" : kind + ".running"],
      ["running", kind === null ? "running" : kind + ".running"],
      ["stopping", kind === null ? "stopping" : kind + ".stopping"],
      ["done", "done"],
      ["stopped", "done"],
      ["error", "done"],
      ["idle", "empty"],
    ] as const) {
      const metrics = batch_task_metrics(
        {
          ...empty_batch_task_snapshot(),
          kind,
          status,
          progress: empty_batch_task_progress(kind === "translation" ? "item" : "request", 1),
        },
        0,
      );
      const display = build_batch_task_summary_display({ metrics, kind, t });
      expect(display.status_text).toBe("batch_translation.summary." + suffix);
    }
  });
  it("详情按本轮成功与失败计算进度，时间与速度使用同轮数据", () => {
    const metrics = batch_task_metrics(
      {
        ...empty_batch_task_snapshot(),
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
      completion_percent: metrics.completion_percent,
      waveform_history: [],
      t,
    });
    expect(detail.provider).toBeNull();
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

  it.each([
    [999.99, "999.99 T/S"],
    [1000, "1.00 KT/S"],
    [1000000, "1.00 MT/S"],
  ])("速度 %s 在摘要和详情中使用一致的单位", (speed_value, expected) => {
    const metrics = {
      ...batch_task_metrics(null, 0),
      active: true,
      average_generation_speed: speed_value,
    };
    const summary = build_batch_task_summary_display({ metrics, kind: null, t });
    const detail = build_translation_task_detail_display({
      metrics,
      completion_percent: metrics.completion_percent,
      waveform_history: [],
      t,
    });
    const speed = detail.metric_entries.find((entry) => entry.key === "speed")!;
    expect(summary.speed_text).toBe(expected);
    expect(`${speed.value_text} ${speed.unit_text}`).toBe(expected);
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
});
