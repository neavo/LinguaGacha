import { describe, expect, it, vi } from "vitest";
import {
  create_project_opened_for_cache_event,
  create_project_unloaded_event,
} from "../project/project-events";
import { ProjectEventBus } from "../project/project-events";
import type { ProjectEvent } from "../project/project-events";

describe("app-events", () => {
  it("创建工程缓存热机事件时固定全量 section 并克隆 revision", () => {
    const section_revisions = { project: 1, items: 2 };

    const event = create_project_opened_for_cache_event({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: section_revisions,
    });
    section_revisions.items = 99;

    expect(event).toMatchObject({
      type: "project.opened_for_cache",
      projectPath: "E:/Project/demo.lg",
      source: "project_lifecycle",
      affectedSections: [
        "project",
        "files",
        "items",
        "quality",
        "prompts",
        "analysis",
        "proofreading",
      ],
      sectionRevisions: {
        project: 1,
        items: 2,
      },
    });
  });

  it("创建工程卸载事件时不继承旧 section revision", () => {
    expect(create_project_unloaded_event("E:/Project/demo.lg")).toEqual({
      type: "project.unloaded",
      projectPath: "E:/Project/demo.lg",
      source: "project_lifecycle",
      affectedSections: [],
      sectionRevisions: {},
    });
  });
});

function create_items_event(): ProjectEvent {
  return {
    type: "project.items.changed",
    projectPath: "E:/Project/demo.lg",
    source: "project_mutation",
    affectedSections: ["items"],
    sectionRevisions: { items: 1 },
    scope: "items-full",
  };
}

describe("ProjectEventBus", () => {
  it("按订阅顺序等待同步和异步 handler，并返回成功结果", async () => {
    const bus = new ProjectEventBus();
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
    const bus = new ProjectEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("project.items.changed", handler);

    unsubscribe();
    const result = await bus.publish(create_items_event());

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("收集 handler 异常并继续分发后续订阅者", async () => {
    const bus = new ProjectEventBus();
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
