import { workspace_execution } from "../../../test/agent-workspace-fixture";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { format_agent_workspace_typescript_api } from "../workspace/runtime/tool/api-description";
import type { AgentWorkspacePort } from "../workspace/service";
import {
  create_agent_workspace_tools,
  type AgentTodoPort,
  type AgentWorkspaceApprovalPort,
} from "./workspace";

type WorkspaceToolResult = { details: unknown; content: { type: string; text: string }[] };

describe("Agent 工作区工具", () => {
  it("工作区图片作为 SDK image content 返回，摘要不包含图片字节", async () => {
    const workspace = build_workspace_port();
    workspace.run = vi.fn(async () => ({
      execution: workspace_execution(),
      todos: [],
      images: [
        {
          path: "work/image.webp",
          image: {
            mimeType: "image/webp" as const,
            data: "aW1hZ2U=",
            width: 100,
            height: 50,
            originalWidth: 100,
            originalHeight: 50,
          },
        },
      ],
    }));
    const tools = create_agent_workspace_tools({
      workspace,
      todo: build_todo_port(),
      approval: build_approval_port(),
    });
    const result = await read_tool(tools, "workspace_run").execute(
      "image",
      { script: "await ws.emitImage('work/image.webp');" },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.content).toContainEqual({
      type: "image",
      mimeType: "image/webp",
      data: "aW1hZ2U=",
    });
    expect(result.details).toMatchObject({
      images: [
        {
          path: "work/image.webp",
          mime_type: "image/webp",
          width: 100,
          height: 50,
          original_width: 100,
          original_height: 50,
        },
      ],
    });
    expect(JSON.stringify(result.details)).not.toContain("aW1hZ2U=");
  });
  it("两个工具只适配脚本参数、取消信号与服务结果", async () => {
    const workspace = build_workspace_port();
    const todo = build_todo_port(["发现目标"]);
    const tools = create_agent_workspace_tools({
      workspace,
      todo,
      approval: build_approval_port(),
    });
    const script_tool = read_tool(tools, "workspace_run");
    const apply_tool = read_tool(tools, "workspace_apply");

    const script = (await script_tool.execute(
      "script",
      { script: "console.log(JSON.stringify({ changed: 2 }));" },
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

    expect(workspace.run).toHaveBeenCalledWith(
      "console.log(JSON.stringify({ changed: 2 }));",
      ["发现目标"],
      expect.any(AbortSignal),
    );
    expect(todo.write).toHaveBeenCalledWith(["核验结果"]);
    expect(workspace.apply_workspace).toHaveBeenCalledOnce();
    expect(script.details).toEqual(workspace_execution({ changed: 2 }));
    expect(JSON.parse(script.content[0]!.text)).toEqual(script.details);
    expect(applied.details).toEqual({ status: "applied", changes: { items: { updated: 2 } } });
  });

  it("公开完整脚本 API 并校验两个工具的参数边界", () => {
    const tools = create_agent_workspace_tools({
      workspace: build_workspace_port(),
      todo: build_todo_port(),
      approval: build_approval_port(),
    });
    const script_tool = read_tool(tools, "workspace_run");
    const apply_tool = read_tool(tools, "workspace_apply");

    expect(script_tool.description).toContain(format_agent_workspace_typescript_api());
    expect(validate(script_tool, { script: "console.log(null);" })).toEqual({
      script: "console.log(null);",
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
    workspace.run = vi.fn(async () => {
      await run_released;
      return { images: [], execution: workspace_execution(), todos: ["迟到事项"] };
    });
    const todo = build_todo_port(["原有事项"]);
    const script_tool = read_tool(
      create_agent_workspace_tools({
        workspace,
        todo,
        approval: build_approval_port(),
      }),
      "workspace_run",
    );
    const controller = new AbortController();
    const reason = new Error("停止任务");

    const result = script_tool.execute(
      "script",
      { script: "console.log(null);" },
      controller.signal,
      undefined,
      undefined as never,
    );
    await vi.waitFor(() => expect(workspace.run).toHaveBeenCalledOnce());
    controller.abort(reason);
    release_run();

    await expect(result).rejects.toBe(reason);
    expect(todo.write).not.toHaveBeenCalled();
  });

  it("脚本失败时保留调用前 Todo", async () => {
    const workspace = build_workspace_port();
    workspace.run = vi.fn(async () => Promise.reject(new Error("脚本失败")));
    const todo = build_todo_port(["恢复任务"]);
    const script_tool = read_tool(
      create_agent_workspace_tools({ workspace, todo, approval: build_approval_port() }),
      "workspace_run",
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
function build_workspace_port(): Pick<AgentWorkspacePort, "run" | "apply_workspace"> {
  return {
    run: vi.fn(async () => ({
      images: [],
      execution: workspace_execution({ changed: 2 }),
      todos: ["核验结果"],
    })),
    apply_workspace: vi.fn(async (request_approval) => {
      await request_approval?.({
        pdf: 0,
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

/** 隔离工具调用期间的 Todo 副本与最终提交。 */
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
    wait_for_decision: vi.fn(async () => ({ auto_revision: null })),
    activate_auto: vi.fn(),
  };
}
