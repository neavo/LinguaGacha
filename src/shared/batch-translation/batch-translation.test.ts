import { describe, expect, it } from "vitest";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import {
  create_empty_batch_translation_snapshot,
  should_open_translation_export_followup,
  normalize_batch_translation_snapshot,
  clone_translation_task_snapshot,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
} from "./batch-translation";

describe("批量翻译展示", () => {
  it("运行配置经传输与历史复制保留，缺失配置保持为空", () => {
    const config = {
      model_name: "执行模型",
      model_id: "model",
      thinking_level: "HIGH" as const,
      source_language: "JA",
      target_language: "ZH",
    };
    const snapshot = normalize_batch_translation_snapshot({ batch_translation: { config } });
    const cloned = clone_translation_task_snapshot(snapshot);
    config.model_name = "新默认模型";
    expect(cloned.config?.model_name).toBe("执行模型");
    expect(cloned.config).not.toBe(snapshot.config);
    expect(normalize_batch_translation_snapshot({}).config).toBeUndefined();
  });
  it("停止来源随 HTTP 归一与快照复制保留", () => {
    const snapshot = normalize_batch_translation_snapshot({
      batch_translation: {
        ...create_empty_batch_translation_snapshot(),
        status: "stopped",
        stop_source: "user",
      },
    });
    expect(clone_translation_task_snapshot(snapshot)).toMatchObject({
      status: "stopped",
      stop_source: "user",
    });
  });
  it("进度与 scope 在读取边界归一化，克隆隔离引用", () => {
    const snapshot = normalize_batch_translation_snapshot({
      batch_translation: {
        revision: 7,
        status: "running",
        progress: normalize_batch_translation_progress({ line: 3, total_line: 4 }),
        scope: { kind: "items", item_ids: [2, 3, 2, -1] },
      },
    });
    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [2, 3] });
    const cloned = clone_translation_task_snapshot(snapshot);
    cloned.progress.line = 9;
    if (cloned.scope.kind === "items") cloned.scope.item_ids.push(9);
    expect(snapshot.progress.line).toBe(3);
    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [2, 3] });
  });
  it("已知总量的当前快照优先于历史停止态", () => {
    const snapshot = create_empty_batch_translation_snapshot();
    snapshot.progress.total_line = 2;
    expect(
      resolve_translation_task_display_snapshot({
        current_snapshot: snapshot,
        last_snapshot: { ...snapshot, status: "stopping" },
      }),
    ).toBe(snapshot);
  });
  it("空闲当前快照回退到有结果的历史终态", () => {
    const snapshot = create_empty_batch_translation_snapshot();
    const last = create_empty_batch_translation_snapshot();
    last.progress.line = 2;
    last.status = "done";
    expect(
      resolve_translation_task_display_snapshot({
        current_snapshot: snapshot,
        last_snapshot: last,
      }),
    ).toBe(last);
  });
  it("进度计算完成度、剩余时间和生成速度", () => {
    const snapshot = create_empty_batch_translation_snapshot();
    snapshot.status = "running";
    Object.assign(snapshot.progress, {
      line: 3,
      total_line: 4,
      processed_line: 2,
      total_tokens: 90,
      total_input_tokens: 40,
      total_reasoning_tokens: 20,
      total_output_tokens: 30,
      start_time: 2,
    });
    expect(resolve_translation_task_metrics({ snapshot, now_seconds: 8 })).toMatchObject({
      active: true,
      completion_percent: 75,
      processed_count: 2,
      elapsed_seconds: 6,
      remaining_seconds: 2,
      average_generation_speed: 50 / 6,
      input_tokens: 40,
      reasoning_tokens: 20,
      output_tokens: 30,
    });
  });
});

describe("全量翻译完成导出", () => {
  it.each([
    ["完整翻译从运行态完成时打开生成译文确认", "running", "done", "all", true],
    ["校对页局部重翻完成时不打开生成译文确认", "running", "done", "items", false],
    ["用户主动停止翻译后不打开生成译文确认", "stopping", "stopped", "all", false],
    ["首屏已有完成态翻译快照不打开生成译文确认", "idle", "done", "all", false],
  ] as const)("%s", (_name, previous_status, next_status, scope_kind, expected) => {
    expect(
      should_open_translation_export_followup({
        previous_status,
        next_status,
        scope: scope_kind === "items" ? { kind: "items", item_ids: [2, 1] } : { kind: "all" },
      }),
    ).toBe(expected);
  });
});
