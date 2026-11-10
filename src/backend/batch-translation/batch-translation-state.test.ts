import { BatchTaskRuntime } from "../batch-task/batch-task-runtime";
import { describe, expect, it, vi } from "vitest";
import { BatchTranslationState } from "./batch-translation-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectDatabase } from "../database/database-operations";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";

/** 组合真实运行态，验证翻译目标与工程统计的投影。 */
function setup() {
  const database = new ProjectDatabase("1.0.0");
  const gate = new RuntimeOperationGate();
  const session = new ProjectSessionState();
  const tasks = new BatchTaskRuntime(session, gate);
  const runtime = new BatchTranslationState(session, database, tasks);
  return { runtime, gate, database, session, tasks };
}
/** 显式控制执行和发布的收尾时机。 */
function deferred<T>() {
  return Promise.withResolvers<T>();
}
/** 提供已完成两条的最小运行结果。 */
const result = () => ({
  status: "done" as const,
  progress: normalize_batch_translation_progress({ processed_line: 2, total_line: 2 }),
});

describe("翻译目标与工程统计投影", () => {
  it("异步读取期间目标与本轮进度保持同一版本", async () => {
    const { runtime, database } = setup();
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, async () => {
      const pending = deferred<ReturnType<typeof normalize_batch_translation_progress>>();
      vi.spyOn(runtime, "read_progress").mockReturnValueOnce(pending.promise);
      const before = runtime.build_snapshot();
      await runtime.publish_targets(handle, new Set([2]));
      pending.resolve(normalize_batch_translation_progress({}));
      expect(await before).toMatchObject({ pending_item_ids: [], run_progress: undefined });
      expect(await runtime.build_snapshot()).toMatchObject({
        pending_item_ids: [2],
        run_progress: { total_line: 1 },
      });
      return result();
    });
    await handle.completion;
    await runtime.dispose();
    await database.close();
  });
  it.each(["done", "stopped", "error"] as const)(
    "实际目标和总量一起发布，提交移除 ID，%s 终态清空 ID",
    async (status) => {
      const { runtime, database, tasks } = setup();
      const item_ids = new Set([1, 2, 3]);
      const frames: import("../../domain/batch-translation").BatchTranslationSnapshot[] = [];
      tasks.subscribe(async () => {
        const snapshot = await runtime.build_snapshot();
        frames.push(snapshot);
      });
      const handle = runtime.begin_standalone("retranslate");
      expect(await runtime.build_snapshot()).toMatchObject({
        pending_item_ids: [],
        run_progress: undefined,
      });
      await runtime.publish_targets(handle, item_ids);
      item_ids.add(4);
      expect(frames.at(-1)).toMatchObject({
        pending_item_ids: [1, 2, 3],
        run_progress: { total_line: 3, processed_line: 0 },
      });
      await runtime.publish_progress(handle, [2]);
      expect((await runtime.build_snapshot()).pending_item_ids).toEqual([1, 3]);
      if (status === "stopped") {
        await tasks.request_stop(handle.run_id);
        expect(handle.signal.aborted).toBe(true);
        expect((await runtime.build_snapshot()).status).toBe("stopping");
      }
      await runtime.execute(handle, async () => ({ ...result(), status }));
      await handle.completion;
      expect(await runtime.build_snapshot()).toMatchObject({
        status,
        source: "standalone",
        pending_item_ids: [],
      });
      await runtime.dispose();
      await database.close();
    },
  );
  it("异常收尾读取失败仍发布错误终态并清空目标", async () => {
    const { runtime, database, tasks } = setup();
    const pending_frames: Array<readonly number[]> = [];
    tasks.subscribe(async () => {
      const snapshot = await runtime.build_snapshot();
      pending_frames.push(snapshot.pending_item_ids);
    });
    const handle = runtime.begin_standalone("retranslate");
    await runtime.execute(handle, async () => {
      await runtime.publish_targets(handle, new Set([1]));
      vi.spyOn(runtime, "read_progress").mockRejectedValueOnce(new Error("progress read failed"));
      throw new Error("execution failed");
    });
    await expect(handle.completion).rejects.toThrow();
    expect(pending_frames).toContainEqual([1]);
    expect(pending_frames.at(-1)).toEqual([]);
    expect(await runtime.build_snapshot()).toMatchObject({
      status: "error",
      pending_item_ids: [],
      request_in_flight_count: 0,
      request_recovery: null,
    });
    await runtime.dispose();
    await database.close();
  });
});
