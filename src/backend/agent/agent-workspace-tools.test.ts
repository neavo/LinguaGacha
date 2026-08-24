import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { AGENT_WORKSPACE_API } from "../../shared/backend-runtime";
import type { AgentWorkspacePort } from "./agent-workspace-service";
import { create_agent_workspace_tools } from "./agent-workspace-tools";

type WorkspaceToolResult = { details: unknown };

describe("Agent 工作区工具", () => {
  it("两个工具只适配脚本参数、取消信号与服务结果", async () => {
    const workspace = build_workspace_port();
    const tools = create_agent_workspace_tools(workspace);
    expect(new Set(tools.map((tool) => tool.name))).toEqual(
      new Set(["workspace_script", "workspace_apply"]),
    );
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    const script = (await script_tool.execute(
      "script",
      { script: "return { changed: 2 };" },
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

    expect(workspace.run_script).toHaveBeenCalledWith(
      "return { changed: 2 };",
      expect.any(AbortSignal),
    );
    expect(workspace.apply_workspace).toHaveBeenCalledOnce();
    expect(script.details).toEqual({ result: { changed: 2 } });
    expect(applied.details).toEqual({ status: "applied", changes: { items: { updated: 2 } } });
  });

  it("函数工具 Schema 只约束两个跨 Agent loop 的公开入口", () => {
    const tools = create_agent_workspace_tools(build_workspace_port());
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    expect(validate(script_tool, { script: "return null;" })).toEqual({
      script: "return null;",
    });
    expect(validate(apply_tool, {})).toEqual({});
    expect(() => validate(script_tool, { script: "" })).toThrow();
    expect(() => validate(apply_tool, { target: "items" })).toThrow();
  });

  it("workspace_script Schema 在首次调用前公开完整固定 SDK", () => {
    const script_tool = read_tool(
      create_agent_workspace_tools(build_workspace_port()),
      "workspace_script",
    );
    const parameters = script_tool.parameters as {
      properties: { script: { description?: string } };
    };
    const description = parameters.properties.script.description;

    for (const [name, declaration] of Object.entries(AGENT_WORKSPACE_API.members)) {
      expect(description).toContain(`${name}${declaration}`);
    }
    for (const root of Object.values(AGENT_WORKSPACE_API.roots)) {
      expect(description).toContain(root);
    }
    for (const method of AGENT_WORKSPACE_API.publishedMethods) {
      expect(Object.hasOwn(AGENT_WORKSPACE_API.members, method)).toBe(true);
    }
  });

  it("调用前已取消时不触达工作区服务", async () => {
    const workspace = build_workspace_port();
    const script_tool = read_tool(create_agent_workspace_tools(workspace), "workspace_script");
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(
      script_tool.execute(
        "script",
        { script: "return null;" },
        controller.signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("提前取消");
    expect(workspace.run_script).not.toHaveBeenCalled();
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

/** 工具顺序不是查找契约，按稳定公开名称定位目标。 */
function read_tool(
  tools: ReturnType<typeof create_agent_workspace_tools>,
  name: string,
): ReturnType<typeof create_agent_workspace_tools>[number] {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`缺少 ${name} 工具`);
  return tool;
}

/** 测试替换工作区业务边界，不伪造具体服务的私有状态。 */
function build_workspace_port(): AgentWorkspacePort {
  return {
    initialize: vi.fn(async () => undefined),
    reset_workspace: vi.fn(async () => undefined),
    reset_project: vi.fn(async () => undefined),
    run_script: vi.fn(async () => ({ changed: 2 })),
    apply_workspace: vi.fn(async () => ({
      status: "applied",
      changes: { items: { updated: 2 } },
    })),
  };
}
