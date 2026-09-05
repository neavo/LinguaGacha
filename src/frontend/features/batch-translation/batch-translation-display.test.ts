import { describe, expect, it } from "vitest";
import {
  resolve_translation_task_metrics,
  create_empty_batch_translation_snapshot,
} from "@shared/batch-translation/batch-translation";
import {
  build_translation_task_detail_display,
  build_translation_task_summary_display,
} from "./batch-translation-display";
import type { useI18n } from "@frontend/app/locale/locale-provider";
const t: ReturnType<typeof useI18n>["t"] = (key) => key;
describe("批量翻译展示", () => {
  it("详情按任务自身进度显示，时间使用累计时分秒且速度与摘要一致", () => {
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
    const detail = build_translation_task_detail_display({ metrics, waveform_history: [], t });
    expect(detail.completion_percent_text).toBe("25.00%");
    expect(detail.metric_entries).toContainEqual(
      expect.objectContaining({
        key: "elapsed",
        value_text: "24:24:24",
        unit_text: "",
      }),
    );
    const speed = detail.metric_entries.find((entry) => entry.key === "speed")!;
    const summary = build_translation_task_summary_display({ ...metrics, active: true }, t);
    expect(summary.trailing_text).toBe(`${speed.value_text} ${speed.unit_text}`);
    expect(detail.stop_disabled).toBe(true);
  });
});
