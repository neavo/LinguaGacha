import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { AGENT_WORKSPACE_SCRIPT_API } from "../../shared/backend-runtime";
import type { AgentWorkspacePort } from "./agent-workspace-service";
import { create_agent_workspace_tools } from "./agent-workspace-tools";

type WorkspaceToolResult = { details: unknown };

describe("Agent 工作区工具", () => {
  it("三个工具只适配生命周期、脚本参数、取消信号与服务结果", async () => {
    const workspace = build_workspace_port();
    const tools = create_agent_workspace_tools(workspace);
    expect(new Set(tools.map((tool) => tool.name))).toEqual(
      new Set(["workspace_load", "workspace_script", "workspace_apply"]),
    );
    const load_tool = read_tool(tools, "workspace_load");
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    const loaded = (await load_tool.execute(
      "load",
      {},
      undefined,
      undefined,
      undefined as never,
    )) as WorkspaceToolResult;
    const script = (await script_tool.execute(
      "script",
      { script: "async function main() { return { changed: 2 }; }" },
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

    expect(workspace.load_workspace).toHaveBeenCalledOnce();
    expect(workspace.run_script).toHaveBeenCalledWith(
      "async function main() { return { changed: 2 }; }",
      expect.any(AbortSignal),
    );
    expect(workspace.apply_workspace).toHaveBeenCalledOnce();
    expect(loaded.details).toEqual({ status: "loaded", counts: { items: 2 } });
    expect(script.details).toEqual({ result: { changed: 2 } });
    expect(applied.details).toEqual({ status: "applied", changes: { items: { updated: 2 } } });
  });

  it("函数工具 Schema 只约束三个跨 Agent loop 的公开入口", () => {
    const tools = create_agent_workspace_tools(build_workspace_port());
    const load_tool = read_tool(tools, "workspace_load");
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    expect(validate(load_tool, {})).toEqual({});
    expect(validate(script_tool, { script: "async function main() { return null; }" })).toEqual({
      script: "async function main() { return null; }",
    });
    expect(validate(apply_tool, {})).toEqual({});
    expect(() => validate(load_tool, { target: "items" })).toThrow();
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

    expect(description).toContain("除此之外没有其他成员");
    for (const [name, declaration] of Object.entries(AGENT_WORKSPACE_SCRIPT_API.members)) {
      expect(description).toContain(`${name}${declaration}`);
    }
    for (const root of Object.values(AGENT_WORKSPACE_SCRIPT_API.roots)) {
      expect(description).toContain(root);
    }
  });

  it("调用前已取消时不触达工作区服务", async () => {
    const workspace = build_workspace_port();
    const load_tool = read_tool(create_agent_workspace_tools(workspace), "workspace_load");
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(
      load_tool.execute("load", {}, controller.signal, undefined, undefined as never),
    ).rejects.toThrow("提前取消");
    expect(workspace.load_workspace).not.toHaveBeenCalled();
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
    load_workspace: vi.fn(async () => ({ status: "loaded", counts: { items: 2 } })),
    run_script: vi.fn(async () => ({ changed: 2 })),
    apply_workspace: vi.fn(async () => ({
      status: "applied",
      changes: { items: { updated: 2 } },
    })),
  };
}
