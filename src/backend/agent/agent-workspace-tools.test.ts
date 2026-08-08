import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { AgentWorkspacePort } from "./agent-workspace-service";
import { create_agent_workspace_tools } from "./agent-workspace-tools";

type WorkspaceToolResult = { details: unknown };

describe("Agent 工作区工具", () => {
  it("三个工具只适配参数、取消信号与服务结果", async () => {
    const workspace = create_workspace();
    const tools = create_agent_workspace_tools(workspace);
    const export_tool = read_tool(tools, "workspace_export");
    const run_tool = read_tool(tools, "workspace_run");
    const import_tool = read_tool(tools, "workspace_import");

    const exported = (await export_tool.execute(
      "export",
      { target: "items" },
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;
    const run = (await run_tool.execute(
      "run",
      { script: "return { changed: 2 }" },
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;
    const imported = (await import_tool.execute(
      "import",
      {},
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;

    expect(workspace.export_workspace).toHaveBeenCalledWith("items");
    expect(workspace.run_script).toHaveBeenCalledWith(
      "return { changed: 2 }",
      expect.any(AbortSignal),
    );
    expect(workspace.import_workspace).toHaveBeenCalledOnce();
    expect(exported.details).toEqual({ target: "items", counts: { items: 2 } });
    expect(run.details).toEqual({ result: { changed: 2 } });
    expect(imported.details).toEqual({ status: "applied", target: "items", updated: 2 });
  });

  it("Schema 只接受已声明 target、非空脚本和无参数导入", () => {
    const tools = create_agent_workspace_tools(create_workspace());
    const export_tool = read_tool(tools, "workspace_export");
    const run_tool = read_tool(tools, "workspace_run");
    const import_tool = read_tool(tools, "workspace_import");

    expect(validate(export_tool, { target: "items" })).toEqual({ target: "items" });
    expect(validate(run_tool, { script: "return null" })).toEqual({ script: "return null" });
    expect(validate(import_tool, {})).toEqual({});
    expect(() => validate(export_tool, { target: "project" })).toThrow();
    expect(() => validate(run_tool, { script: "" })).toThrow();
    expect(() => validate(import_tool, { target: "items" })).toThrow();
  });

  it("调用前已取消时不触达工作区服务", async () => {
    const workspace = create_workspace();
    const export_tool = create_agent_workspace_tools(workspace)[0];
    if (export_tool === undefined) throw new Error("缺少 workspace_export 工具");
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(
      export_tool.execute(
        "export",
        { target: "items" },
        controller.signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("提前取消");
    expect(workspace.export_workspace).not.toHaveBeenCalled();
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
    export_workspace: vi.fn(async (target) => ({ target, counts: { items: 2 } })),
    run_script: vi.fn(async () => ({ changed: 2 })),
    import_workspace: vi.fn(async () => ({ status: "applied", target: "items", updated: 2 })),
  };
}
