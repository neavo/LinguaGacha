import { describe, expect, it } from "vitest";

import { CoreWorkerClient } from "./worker-client";
import type { CoreWorkerTask } from "./worker-task";

function create_quality_task(pattern: string): CoreWorkerTask {
  return {
    type: "quality_statistics",
    input: {
      rule_key: "glossary",
      entries: [{ entry_id: pattern, src: pattern }],
      items: [{ src: `${pattern} appeared`, dst: "" }],
    },
  };
}

describe("CoreWorkerClient", () => {
  it("在 in_process 模式下按提交顺序执行后台 task", async () => {
    const client = new CoreWorkerClient({ execution: { kind: "in_process" } });

    const first = client.run(create_quality_task("HP"), new AbortController().signal);
    const second = client.run(create_quality_task("MP"), new AbortController().signal);

    await expect(first).resolves.toMatchObject({
      completed_entry_ids: ["HP"],
      matched_count_by_entry_id: { HP: 1 },
    });
    await expect(second).resolves.toMatchObject({
      completed_entry_ids: ["MP"],
      matched_count_by_entry_id: { MP: 1 },
    });

    await client.dispose();
  });

  it("取消排队 task 时拒绝该任务且继续完成已有任务", async () => {
    const client = new CoreWorkerClient({ execution: { kind: "in_process" } });
    const first = client.run(create_quality_task("HP"), new AbortController().signal);
    const controller = new AbortController();
    const queued = client.run(create_quality_task("MP"), controller.signal);

    controller.abort();

    await expect(first).resolves.toMatchObject({
      matched_count_by_entry_id: { HP: 1 },
    });
    await expect(queued).rejects.toMatchObject({ code: "runtime.cancelled" });

    await client.dispose();
  });

  it("取消 active task 时拒绝该任务并继续执行后续任务", async () => {
    const client = new CoreWorkerClient({ execution: { kind: "in_process" } });
    const controller = new AbortController();
    const active = client.run(create_quality_task("HP"), controller.signal);
    const next = client.run(create_quality_task("MP"), new AbortController().signal);

    controller.abort();

    await expect(active).rejects.toMatchObject({ code: "runtime.cancelled" });
    await expect(next).resolves.toMatchObject({
      matched_count_by_entry_id: { MP: 1 },
    });

    await client.dispose();
  });

  it("dispose 后拒绝排队和后续提交的 task", async () => {
    const client = new CoreWorkerClient({ execution: { kind: "in_process" } });
    const running = client.run(create_quality_task("HP"), new AbortController().signal);
    const queued = client.run(create_quality_task("MP"), new AbortController().signal);

    await client.dispose();

    await expect(running).rejects.toMatchObject({ code: "runtime.disposed" });
    await expect(queued).rejects.toMatchObject({ code: "runtime.disposed" });
    await expect(
      client.run(create_quality_task("TP"), new AbortController().signal),
    ).rejects.toMatchObject({ code: "runtime.disposed" });
  });
});
