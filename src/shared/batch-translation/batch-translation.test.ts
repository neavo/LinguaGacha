import { describe, expect, it } from "vitest";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import type { BatchTaskRequestRecovery } from "../../domain/batch-task";
import {
  create_empty_batch_translation_snapshot,
  should_open_translation_export_followup,
  normalize_batch_translation_snapshot,
} from "./batch-translation";

describe("批量翻译展示", () => {
  it.each([
    [{ phase: "retrying" }, { phase: "retrying" }],
    [{ retry_count: 0, retry_at: 123_000 }, null],
    [{ phase: "waiting", retry_count: 0, retry_at: null }, null],
  ])("恢复结构按阶段校验：%j", (request_recovery, expected) => {
    expect(
      normalize_batch_translation_snapshot({
        // 模拟 HTTP / SSE 收到不符合静态类型的外部载荷。
        batch_translation: {
          status: "running",
          request_recovery: request_recovery as unknown as BatchTaskRequestRecovery,
        },
      }).request_recovery,
    ).toEqual(expected);
  });
  it("恢复信息归一后供历史快照共享，停止时清空", () => {
    const recovery = { phase: "waiting" as const, retry_count: 4, retry_at: 123_000 };
    const snapshot = normalize_batch_translation_snapshot({
      batch_translation: { status: "running", request_recovery: recovery },
    });
    recovery.retry_count = 99;
    expect(structuredClone(snapshot).request_recovery).toEqual({
      phase: "waiting",
      retry_count: 4,
      retry_at: 123_000,
    });
    expect(
      normalize_batch_translation_snapshot({
        batch_translation: { ...snapshot, status: "stopped" },
      }).request_recovery,
    ).toBeNull();
    expect(normalize_batch_translation_snapshot({}).request_recovery).toBeNull();
  });
  it.each(["standalone", "agent", null] as const)("任务来源 %s 经归一与复制保留", (source) => {
    const snapshot = normalize_batch_translation_snapshot({ batch_translation: { source } });
    expect(structuredClone(snapshot).source).toBe(source);
  });

  it("未提供任务来源时保留空值", () => {
    expect(normalize_batch_translation_snapshot({}).source).toBeNull();
  });
  it("停止来源随 HTTP 归一与快照复制保留", () => {
    const snapshot = normalize_batch_translation_snapshot({
      batch_translation: {
        ...create_empty_batch_translation_snapshot(),
        status: "stopped",
        stop_source: "user",
      },
    });
    expect(structuredClone(snapshot)).toMatchObject({
      status: "stopped",
      stop_source: "user",
    });
  });
  it("进度与待处理 ID 在读取边界归一化，克隆隔离引用", () => {
    const snapshot = normalize_batch_translation_snapshot({
      batch_translation: {
        revision: 7,
        status: "running",
        progress: normalize_batch_translation_progress({ processed_line: 3, total_line: 4 }),
        pending_item_ids: [2, 3, 2, -1],
      },
    });
    expect(snapshot.pending_item_ids).toEqual([2, 3]);
    const cloned = structuredClone(snapshot);
    cloned.progress.processed_line = 9;
    expect(cloned.pending_item_ids).not.toBe(snapshot.pending_item_ids);
    expect(snapshot.progress.processed_line).toBe(3);
    expect(snapshot.pending_item_ids).toEqual([2, 3]);
  });
});

describe("全量翻译完成翻译成果导出", () => {
  it.each([
    ["独立完整翻译完成时打开导出翻译成果确认", "running", "done", "translate", "standalone", true],
    ["AGENT 全量翻译完成不请求翻译成果导出确认", "running", "done", "translate", "agent", false],
    ["来源为空的完成快照不触发翻译成果导出", "running", "done", "translate", null, false],
    [
      "校对页局部重翻完成时不打开导出翻译成果确认",
      "running",
      "done",
      "retranslate",
      "standalone",
      false,
    ],
    [
      "用户主动停止翻译后不打开导出翻译成果确认",
      "stopping",
      "stopped",
      "translate",
      "standalone",
      false,
    ],
    [
      "首屏已有完成态翻译快照不打开导出翻译成果确认",
      "idle",
      "done",
      "translate",
      "standalone",
      false,
    ],
    ["重复完成快照不再触发翻译成果导出", "done", "done", "translate", "standalone", false],
    ["执行失败不请求翻译成果导出确认", "running", "error", "translate", "standalone", false],
  ] as const)("%s", (_name, previous_status, status, operation, source, expected) => {
    expect(
      should_open_translation_export_followup(previous_status, {
        ...create_empty_batch_translation_snapshot(),
        status,
        source,
        operation,
      }),
    ).toBe(expected);
  });
});
