import { describe, expect, it, vi } from "vitest";

import { AppEventBus } from "./app-event-bus";
import type { AppEvent } from "./app-events";

function create_items_event(): AppEvent {
  return {
    type: "project.items.changed",
    projectPath: "E:/Project/demo.lg",
    source: "project_mutation",
    affectedSections: ["items"],
    sectionRevisions: { items: 1 },
    scope: "items-full",
  };
}

describe("AppEventBus", () => {
  it("按订阅顺序等待同步和异步 handler，并返回成功结果", async () => {
    const bus = new AppEventBus();
    const calls: string[] = [];
    bus.subscribe("project.items.changed", () => {
      calls.push("first");
    });
    bus.subscribe("project.items.changed", async () => {
      calls.push("second");
    });

    const result = await bus.publish(create_items_event());

    expect(calls).toEqual(["first", "second"]);
    expect(result).toEqual([
      { type: "project.items.changed", handlerIndex: 0, ok: true },
      { type: "project.items.changed", handlerIndex: 1, ok: true },
    ]);
  });

  it("取消订阅后不再调用 handler", async () => {
    const bus = new AppEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("project.items.changed", handler);

    unsubscribe();
    const result = await bus.publish(create_items_event());

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("收集 handler 异常并继续分发后续订阅者", async () => {
    const bus = new AppEventBus();
    const error = new Error("缓存刷新失败");
    const final_handler = vi.fn();
    bus.subscribe("project.items.changed", () => {
      throw error;
    });
    bus.subscribe("project.items.changed", final_handler);

    const result = await bus.publish(create_items_event());

    expect(final_handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { type: "project.items.changed", handlerIndex: 0, ok: false, error },
      { type: "project.items.changed", handlerIndex: 1, ok: true },
    ]);
  });
});
