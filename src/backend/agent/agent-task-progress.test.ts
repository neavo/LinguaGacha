import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { AgentTaskProgress, create_agent_task_progress_tools } from "./agent-task-progress";
import { AgentToolError } from "./agent-tool";

describe("Agent task_progress 工具", () => {
  it("以普通对象根公开单一工具 Schema", () => {
    const [tool] = create_agent_task_progress_tools(new AgentTaskProgress());

    expect(tool?.name).toBe("task_progress");
    expect(tool?.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(tool?.parameters).not.toHaveProperty("anyOf");
    expect(() => validate(tool, { action: "start", title: "任务", items: [] })).toThrow();
    expect(() =>
      validate(tool, {
        action: "start",
        title: "任务",
        items: [{ key: "seed", phase: "discover", label: "基础扫描" }],
      }),
    ).not.toThrow();
  });

  it.each([
    ["start 缺少 items", { action: "start", title: "任务" }],
    ["advance 缺少 complete", { action: "advance" }],
    ["read 携带 title", { action: "read", title: "多余字段" }],
    ["finish 携带 reason", { action: "finish", reason: "多余字段" }],
    ["cancel 缺少 reason", { action: "cancel" }],
  ])("工具入口拒绝 %s", async (_label, args) => {
    const [tool] = create_agent_task_progress_tools(new AgentTaskProgress());

    await expect(execute(tool, args)).rejects.toMatchObject({
      details: { code: "task_progress.invalid_parameters", action: args.action },
    });
  });

  it("工具入口保持五种 action 的状态机语义", async () => {
    const progress = new AgentTaskProgress();
    const [tool] = create_agent_task_progress_tools(progress);
    const item = { key: "seed", phase: "discover", label: "基础扫描" };

    await execute(tool, { action: "start", title: "任务", items: [item] });
    await execute(tool, { action: "read" });
    await execute(tool, { action: "advance", complete: [item.key] });
    await execute(tool, { action: "finish" });
    await execute(tool, { action: "start", title: "任务", items: [item] });
    await execute(tool, { action: "cancel", reason: "切换任务" });

    expect(progress.read()).toEqual({ status: "idle" });
  });

  it("原子完成当前工作并追加派生工作", () => {
    const progress = new AgentTaskProgress();

    progress.start("提取质量规则", [
      { key: "seed", phase: "discover", label: "基础扫描" },
      { key: "residual", phase: "residual", label: "独立残差" },
    ]);
    const result = progress.advance(
      ["seed"],
      [
        {
          key: "derived:names",
          phase: "discover",
          label: "扫描同构名称槽位",
        },
      ],
    );

    expect(result).toEqual({
      status: "active",
      title: "提取质量规则",
      item_count: 3,
      completed_count: 1,
      pending_count: 2,
      phases: {
        discover: { total: 2, completed: 1, pending: 1 },
        residual: { total: 1, completed: 0, pending: 1 },
      },
      next_items: [
        { key: "residual", phase: "residual", label: "独立残差" },
        {
          key: "derived:names",
          phase: "discover",
          label: "扫描同构名称槽位",
        },
      ],
    });
  });

  it("advance 校验失败时不产生部分状态", () => {
    const progress = new AgentTaskProgress();
    progress.start("任务", [{ key: "seed", phase: "discover", label: "基础扫描" }]);

    expect(
      capture_tool_error(() =>
        progress.advance(["missing"], [{ key: "derived", phase: "discover", label: "派生扫描" }]),
      ).details,
    ).toEqual({ code: "task_progress.item_not_found", key: "missing" });
    expect(progress.read()).toMatchObject({
      completed_count: 0,
      pending_count: 1,
      next_items: [{ key: "seed" }],
    });
  });

  it("存在待办时拒绝结束，全部完成后释放活动任务", () => {
    const progress = new AgentTaskProgress();
    progress.start("任务", [{ key: "seed", phase: "discover", label: "基础扫描" }]);

    expect(capture_tool_error(() => progress.finish()).details).toEqual({
      code: "task_progress.pending_items",
      pending_count: 1,
      next_keys: ["seed"],
    });
    progress.advance(["seed"]);
    expect(progress.finish()).toEqual({
      status: "finished",
      title: "任务",
      item_count: 1,
    });
    expect(progress.read()).toEqual({ status: "idle" });
  });

  it("活动任务不能被覆盖，但可以显式取消或由会话 reset 清空", () => {
    const progress = new AgentTaskProgress();
    const items = [{ key: "seed", phase: "discover", label: "基础扫描" }];
    progress.start("旧任务", items);

    expect(capture_tool_error(() => progress.start("旧任务", items)).details).toEqual({
      code: "task_progress.active",
    });
    expect(progress.cancel("用户改为处理另一项任务")).toMatchObject({
      status: "cancelled",
      title: "旧任务",
      pending_count: 1,
    });
    progress.start("旧任务", items);
    progress.reset();
    expect(progress.read()).toEqual({ status: "idle" });
  });

  it("向 UI 投影全部待办标签并在队列清空后隐藏", () => {
    const progress = new AgentTaskProgress();
    const items = Array.from({ length: 21 }, (_, index) => ({
      key: `item-${index.toString()}`,
      phase: "review",
      label: `检查 ${index.toString()}`,
    }));

    progress.start("完整检查", items);
    expect(progress.read_pending_labels()).toEqual(items.map((item) => item.label));

    progress.advance(items.map((item) => item.key));
    expect(progress.read_pending_labels()).toEqual([]);
  });
});

/** 复用 SDK 的真实参数校验，覆盖模型可见字段类型边界。 */
function validate(
  tool: ReturnType<typeof create_agent_task_progress_tools>[number] | undefined,
  args: unknown,
): ReturnType<typeof validateToolArguments> {
  if (tool === undefined) throw new Error("缺少 task_progress");
  return validateToolArguments(tool, {
    type: "toolCall",
    id: "task-progress-call",
    name: tool.name,
    arguments: args,
  } as ToolCall);
}

/** 先走 SDK 字段类型校验，再观察产品工具入口的条件语义。 */
async function execute(
  tool: ReturnType<typeof create_agent_task_progress_tools>[number] | undefined,
  args: unknown,
): Promise<void> {
  if (tool === undefined) throw new Error("缺少 task_progress");
  const params = validate(tool, args);
  await tool.execute("task-progress-call", params, undefined, undefined, undefined as never);
}

/** 捕获状态机的稳定业务错误，同时拒绝吞掉其它异常或缺失异常。 */
function capture_tool_error(action: () => unknown): AgentToolError {
  try {
    action();
  } catch (error) {
    if (error instanceof AgentToolError) return error;
    throw error;
  }
  throw new Error("预期 task_progress 拒绝操作");
}
