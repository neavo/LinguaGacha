import { describe, expect, it } from "vitest";

import { AGENT_INPUT_QUEUE_LIMIT } from "../../shared/agent";
import { AgentInputQueue } from "./agent-input-queue";

const message = (text: string) => ({ text, attachments: [] });

describe("AgentInputQueue", () => {
  it("按顺序排队、修改、重排与删除", () => {
    const queue = new AgentInputQueue();
    const first = queue.enqueue(message("一"));
    const second = queue.enqueue(message("二"));

    queue.update(first.id, message("一改"));
    queue.reorder([second.id, first.id]);
    queue.delete(first.id);

    expect(queue.read_snapshot(false)).toMatchObject({
      paused: false,
      canSendNow: false,
      items: [{ id: second.id, text: "二", status: "queued" }],
    });
  });

  it("立即发送只允许一个 sending，并可确认或回滚", () => {
    const queue = new AgentInputQueue();
    const first = queue.enqueue(message("一"));
    const second = queue.enqueue(message("二"));

    queue.begin_send(second.id);
    expect(() => queue.begin_send(first.id)).toThrow("runtime.busy");
    expect(queue.read_snapshot(true).items[1]?.status).toBe("sending");
    queue.cancel_send();
    expect(queue.read_snapshot(true).items[1]?.status).toBe("queued");
    queue.begin_send(second.id);
    expect(queue.commit_send()?.id).toBe(second.id);
  });

  it("暂停保留队列，恢复后继续按 FIFO 取出", () => {
    const queue = new AgentInputQueue();
    queue.enqueue(message("一"));
    queue.pause();
    expect(queue.take_next()).toBeNull();
    expect(queue.read_snapshot(true)).toMatchObject({ paused: true, canSendNow: true });
    queue.resume();
    expect(queue.take_next()?.text).toBe("一");
    expect(queue.read_snapshot(true).paused).toBe(false);
  });

  it("拒绝越界、非法顺序和修改 sending 项", () => {
    const queue = new AgentInputQueue();
    const first = queue.enqueue(message("一"));
    queue.begin_send(first.id);
    expect(() => queue.update(first.id, message("改"))).toThrow("request.validation_failed");
    queue.cancel_send();
    expect(() => queue.reorder([])).toThrow("request.validation_failed");
    for (let index = 1; index < AGENT_INPUT_QUEUE_LIMIT; index += 1) {
      queue.enqueue(message(index.toString()));
    }
    expect(() => queue.enqueue(message("越界"))).toThrow("request.validation_failed");
  });
});
