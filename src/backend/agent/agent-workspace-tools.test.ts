import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { AgentWorkspacePort } from "./agent-workspace-service";
import { create_agent_workspace_tools } from "./agent-workspace-tools";

type WorkspaceToolResult = { details: unknown };

describe("Agent 工作区工具", () => {
  it("四个工具只适配参数、取消信号与服务结果", async () => {
    const workspace = create_workspace();
    const tools = create_agent_workspace_tools(workspace);
    const create_tool = read_tool(tools, "workspace_create");
    const recipe_tool = read_tool(tools, "workspace_recipe");
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    const created = (await create_tool.execute(
      "create",
      {},
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;
    const script = (await script_tool.execute(
      "script",
      { script: "return { changed: 2 }" },
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;
    const recipe = (await recipe_tool.execute(
      "recipe",
      { name: "query-items", args: { limit: 10 } },
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;
    const applied = (await apply_tool.execute(
      "apply",
      {},
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;

    expect(workspace.create_workspace).toHaveBeenCalledOnce();
    expect(workspace.run_script).toHaveBeenCalledWith(
      "return { changed: 2 }",
      expect.any(AbortSignal),
    );
    expect(workspace.run_recipe).toHaveBeenCalledWith(
      "query-items",
      { limit: 10 },
      expect.any(AbortSignal),
    );
    expect(workspace.apply_workspace).toHaveBeenCalledOnce();
    expect(created.details).toEqual({
      project_meta: { counts: { items: 2 } },
      contract: { datasets: {} },
    });
    expect(script.details).toEqual({ result: { changed: 2 } });
    expect(recipe.details).toEqual({ result: { total_item_count: 2 } });
    expect(applied.details).toEqual({ status: "applied", changes: { items: { updated: 2 } } });
  });

  it("Schema 严格区分 recipe 参数并限制枚举与分页", () => {
    const tools = create_agent_workspace_tools(create_workspace());
    const create_tool = read_tool(tools, "workspace_create");
    const recipe_tool = read_tool(tools, "workspace_recipe");
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    expect(validate(create_tool, {})).toEqual({});
    expect(validate(script_tool, { script: "return null" })).toEqual({ script: "return null" });
    expect(validate(recipe_tool, { name: "query-items", args: {} })).toEqual({
      name: "query-items",
      args: {},
    });
    expect(
      validate(recipe_tool, {
        name: "query-item-contexts",
        args: { item_ids: [1, 2] },
      }),
    ).toMatchObject({ name: "query-item-contexts" });
    expect(
      validate(recipe_tool, {
        name: "query-quality-rule-groups",
        args: { kind: "glossary", keywords: ["姫"], include_examples: true, limit: 100 },
      }),
    ).toMatchObject({ name: "query-quality-rule-groups" });
    expect(validate(apply_tool, {})).toEqual({});
    expect(() => validate(create_tool, { target: "items" })).toThrow();
    expect(() => validate(script_tool, { script: "" })).toThrow();
    expect(() => validate(recipe_tool, { name: "query-items", args: { limit: 101 } })).toThrow();
    expect(() =>
      validate(recipe_tool, { name: "query-items", args: { filters: { statuses: ["BAD"] } } }),
    ).toThrow();
    expect(() =>
      validate(recipe_tool, { name: "query-item-contexts", args: { item_ids: [] } }),
    ).toThrow();
    expect(() =>
      validate(recipe_tool, { name: "query-quality-rule-groups", args: { kind: "unknown" } }),
    ).toThrow();
    expect(() =>
      validate(recipe_tool, {
        name: "query-quality-rule-groups",
        args: { kind: "glossary", extra: true },
      }),
    ).toThrow();
    expect(() => validate(apply_tool, { target: "items" })).toThrow();
  });

  it("调用前已取消时不触达工作区服务", async () => {
    const workspace = create_workspace();
    const create_tool = read_tool(create_agent_workspace_tools(workspace), "workspace_create");
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(
      create_tool.execute("create", {}, controller.signal, undefined, undefined as never),
    ).rejects.toThrow("提前取消");
    expect(workspace.create_workspace).not.toHaveBeenCalled();
  });
});

/** 使用真实 SDK 校验入口证明模型参数契约。 */
function validate(tool: ReturnType<typeof create_agent_workspace_tools>[number], args: unknown) {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: tool.name,
    name: tool.name,
    arguments: args,
  } as ToolCall);
}

/** 工具顺序不是测试契约，按稳定公开名称定位目标。 */
function read_tool(
  tools: ReturnType<typeof create_agent_workspace_tools>,
  name: string,
): ReturnType<typeof create_agent_workspace_tools>[number] {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`缺少 ${name} 工具`);
  return tool;
}

/** 测试替换工作区业务边界，不伪造具体服务的私有状态。 */
function create_workspace(): AgentWorkspacePort {
  return {
    initialize: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    create_workspace: vi.fn(async () => ({
      project_meta: { counts: { items: 2 } },
      contract: { datasets: {} },
    })),
    run_recipe: vi.fn(async () => ({ total_item_count: 2 })),
    run_script: vi.fn(async () => ({ changed: 2 })),
    apply_workspace: vi.fn(async () => ({
      status: "applied",
      changes: { items: { updated: 2 } },
    })),
  };
}
