import { describe, expect, it } from "vitest";
import {
  resolve_translation_task_metrics,
  create_empty_batch_translation_snapshot,
} from "@shared/batch-translation/batch-translation";
import {
  build_translation_task_detail_display,
  build_translation_task_summary_display,
} from "./batch-translation-display";
import type { useI18n } from "@frontend/app/locale/locale-context";
const t: ReturnType<typeof useI18n>["t"] = (key) => key;
describe("批量翻译展示", () => {
  it("详情采用工程完成率，时间与速度继续消费本轮任务", () => {
    const metrics = resolve_translation_task_metrics({
      snapshot: {
        ...create_empty_batch_translation_snapshot(),
        status: "stopped",
        progress: {
          ...create_empty_batch_translation_snapshot().progress,
          line: 1,
          total_line: 4,
          time: 87864.8,
          total_output_tokens: 878648,
        },
      },
      now_seconds: 100000,
    });
    const detail = build_translation_task_detail_display({
      metrics,
      completion_percent: 80,
      waveform_history: [],
      t,
    });
    expect(detail.provider).toBeNull();
    expect(detail.completion_percent_text).toBe("80.00%");
    expect(detail.metric_entries).toContainEqual(
      expect.objectContaining({
        key: "elapsed",
        value_text: "24:24:24",
        unit_text: "",
      }),
    );
    const speed = detail.metric_entries.find((entry) => entry.key === "speed")!;
    const summary = build_translation_task_summary_display({ ...metrics, active: true }, t);
    expect(summary.speed_text).toBe(`${speed.value_text} ${speed.unit_text}`);
    expect(detail.stop_disabled).toBe(true);
  });

  it.each([
    [999.99, "999.99 T/S"],
    [1000, "1.00 KT/S"],
    [1000000, "1.00 MT/S"],
  ])("速度 %s 在摘要和详情中使用一致的单位", (speed_value, expected) => {
    const metrics = {
      ...resolve_translation_task_metrics({ snapshot: null, now_seconds: 0 }),
      active: true,
      average_generation_speed: speed_value,
    };
    const summary = build_translation_task_summary_display(metrics, t);
    const detail = build_translation_task_detail_display({
      metrics,
      completion_percent: 80,
      waveform_history: [],
      t,
    });
    const speed = detail.metric_entries.find((entry) => entry.key === "speed")!;
    expect(summary.speed_text).toBe(expected);
    expect(`${speed.value_text} ${speed.unit_text}`).toBe(expected);
  });

  it("停止中保留速度，空闲时收起运行指标", () => {
    const metrics = {
      ...resolve_translation_task_metrics({ snapshot: null, now_seconds: 0 }),
      active: true,
      stopping: true,
    };
    const summary = build_translation_task_summary_display(metrics, t);
    expect(summary.status_text).toBe("batch_translation.summary.stopping");
    expect(summary.speed_text).toBe("0.00 T/S");
    expect(summary.tone).toBe("warning");
    expect(
      build_translation_task_summary_display({ ...metrics, active: false, stopping: false }, t)
        .speed_text,
    ).toBeNull();
  });
});
