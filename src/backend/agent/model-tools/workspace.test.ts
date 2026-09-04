import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { AgentWorkspacePort } from "../workspace/service";
import {
  create_agent_workspace_tools,
  type AgentTodoPort,
  type AgentWorkspaceApprovalPort,
} from "./workspace";

type WorkspaceToolResult = { details: unknown };

describe("Agent 工作区工具", () => {
  it("两个工具只适配脚本参数、取消信号与服务结果", async () => {
    const workspace = build_workspace_port();
    const todo = build_todo_port(["发现目标"]);
    const tools = create_agent_workspace_tools({
      workspace,
      todo,
      approval: build_approval_port(),
    });
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
      ["发现目标"],
      expect.any(AbortSignal),
    );
    expect(todo.write).toHaveBeenCalledWith(["核验结果"]);
    expect(workspace.apply_workspace).toHaveBeenCalledOnce();
    expect(script.details).toEqual({ result: { changed: 2 } });
    expect(applied.details).toEqual({ status: "applied", changes: { items: { updated: 2 } } });
  });

  it("函数工具 Schema 只约束两个跨 Agent loop 的公开入口", () => {
    const tools = create_agent_workspace_tools({
      workspace: build_workspace_port(),
      todo: build_todo_port(),
      approval: build_approval_port(),
    });
    const script_tool = read_tool(tools, "workspace_script");
    const apply_tool = read_tool(tools, "workspace_apply");

    expect(validate(script_tool, { script: "return null;" })).toEqual({
      script: "return null;",
    });
    expect(validate(apply_tool, {})).toEqual({});
    expect(() => validate(script_tool, { script: "" })).toThrow();
    expect(() => validate(apply_tool, { target: "items" })).toThrow();
  });

  it("调用期间取消时不提交迟到的 Todo", async () => {
    const workspace = build_workspace_port();
    let release_run = (): void => undefined;
    const run_released = new Promise<void>((resolve) => {
      release_run = resolve;
    });
    workspace.run_script = vi.fn(async () => {
      await run_released;
      return { result: null, todos: ["迟到事项"] };
    });
    const todo = build_todo_port(["原有事项"]);
    const script_tool = read_tool(
      create_agent_workspace_tools({
        workspace,
        todo,
        approval: build_approval_port(),
      }),
      "workspace_script",
    );
    const controller = new AbortController();
    const reason = new Error("停止任务");

    const result = script_tool.execute(
      "script",
      { script: "return null;" },
      controller.signal,
      undefined,
      undefined as never,
    );
    await vi.waitFor(() => expect(workspace.run_script).toHaveBeenCalledOnce());
    controller.abort(reason);
    release_run();

    await expect(result).rejects.toBe(reason);
    expect(todo.write).not.toHaveBeenCalled();
  });

  it("脚本失败时保留调用前 Todo", async () => {
    const workspace = build_workspace_port();
    workspace.run_script = vi.fn(async () => Promise.reject(new Error("脚本失败")));
    const todo = build_todo_port(["恢复任务"]);
    const script_tool = read_tool(
      create_agent_workspace_tools({ workspace, todo, approval: build_approval_port() }),
      "workspace_script",
    );

    await expect(
      script_tool.execute(
        "script",
        { script: "throw new Error();" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("脚本失败");
    expect(todo.write).not.toHaveBeenCalled();
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
    run_script: vi.fn(async () => ({ result: { changed: 2 }, todos: ["核验结果"] })),
    apply_workspace: vi.fn(async (request_approval) => {
      await request_approval?.({
        items: 2,
        glossary: 0,
        textPreserve: 0,
        preReplacement: 0,
        postReplacement: 0,
        prompts: 0,
      });
      return {
        status: "applied",
        changes: { items: { updated: 2 } },
      };
    }),
  };
}

function build_todo_port(
  todos: string[] = [],
): AgentTodoPort & { write: ReturnType<typeof vi.fn<(todos: readonly string[]) => void>> } {
  return {
    read: () => [...todos],
    write: vi.fn<(todos: readonly string[]) => void>(),
  };
}

/** 工具适配测试使用自动模式，审批状态本身由 AgentService 测试覆盖。 */
function build_approval_port(): AgentWorkspaceApprovalPort {
  return {
    read_mode: () => "auto",
    wait_for_decision: vi.fn(async () => ({ switch_to_auto: false })),
    activate_auto: vi.fn(),
  };
}
