import { describe, expect, it, vi } from "vitest";

import { AGENT_WORKSPACE_RUNTIME_METHODS } from "../methods/registry";
import { AGENT_WORKSPACE_CONTRACT } from "../workspace/contract";
import { execute_agent_workspace_program, read_agent_workspace_runtime_request } from "./execute";
import type { AgentWorkspaceReadPort } from "./data";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

describe("Agent Workspace Deno runtime", () => {
  it("执行异步脚本并投影冻结 contract 与完整领域方法注册表", async () => {
    const response = await execute_agent_workspace_program(async (workspace) => {
      await Promise.resolve();
      return {
        keys: Object.keys(workspace).sort(),
        contract_frozen: Object.isFrozen(workspace.contract),
        todo_frozen: Object.isFrozen(workspace.todo),
        todo_snapshot_frozen: Object.isFrozen(workspace.todo.read()),
      };
    }, read_port());

    expect(response).toEqual({
      ok: true,
      result: {
        keys: ["contract", "todo", ...Object.keys(AGENT_WORKSPACE_RUNTIME_METHODS)].sort(),
        contract_frozen: true,
        todo_frozen: true,
        todo_snapshot_frozen: true,
      },
      todos: [],
    });
  });

  it("在脚本内读取基线并以最终有序 Todo 返回写入", async () => {
    await expect(
      execute_agent_workspace_program(
        async (workspace) => {
          const before = workspace.todo.read();
          workspace.todo.write([" 处理目标 ", "核验结果"]);
          return { before, current: workspace.todo.read() };
        },
        read_port(),
        ["发现目标", "处理目标"],
      ),
    ).resolves.toEqual({
      ok: true,
      result: {
        before: ["发现目标", "处理目标"],
        current: ["处理目标", "核验结果"],
      },
      todos: ["处理目标", "核验结果"],
    });
  });

  it("Todo 写入失败时整次脚本返回失败", async () => {
    await expect(
      execute_agent_workspace_program(async (workspace) => {
        workspace.todo.write([" "]);
        return null;
      }, read_port()),
    ).resolves.toMatchObject({ ok: false });
  });

  it.each([
    ["运行异常", async () => Promise.reject(new Error("boom"))],
    ["未返回", async () => undefined],
    [
      "循环引用",
      async () => {
        const value: Record<string, unknown> = {};
        value["self"] = value;
        return value;
      },
    ],
    ["BigInt", async () => 1n],
    ["超大结果", async () => "a".repeat(AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes + 1)],
  ])("把%s投影为稳定失败 envelope", async (_label, program) => {
    const response = await execute_agent_workspace_program(program, read_port());

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.message).not.toBe("");
  });

  it("保留原生 JSON 对象属性 undefined 省略语义", async () => {
    await expect(
      execute_agent_workspace_program(async () => ({ kept: 1, omitted: undefined }), read_port()),
    ).resolves.toEqual({ ok: true, result: { kept: 1 }, todos: [] });
  });

  it("领域方法通过只读文件端口读取真实 contract 路径", async () => {
    const base = read_port();
    const iterate_jsonl = vi.fn(base.iterateJsonl);
    const port: AgentWorkspaceReadPort = { ...base, iterateJsonl: iterate_jsonl };

    await expect(
      execute_agent_workspace_program(async (workspace) => {
        return await workspace.matchLiterals({
          patterns: [{ key: "alice", text: "alice", case_sensitive: false }],
          examples_per_pattern: 0,
        });
      }, port),
    ).resolves.toMatchObject({ ok: true, result: { matched_item_count: 1 } });
    expect(iterate_jsonl).toHaveBeenCalledWith("items/entries.jsonl");
  });

  it("领域方法按模型可见 Schema 拒绝结构外参数", async () => {
    await expect(
      execute_agent_workspace_program(async (workspace) => {
        return await (workspace.matchLiterals as (args: unknown) => Promise<unknown>)({
          unexpected: true,
        });
      }, read_port()),
    ).resolves.toEqual({
      ok: false,
      message: "matchLiterals args do not match the declared schema",
    });
  });

  it("请求协议拒绝空脚本和额外字段", () => {
    expect(
      read_agent_workspace_runtime_request({ script: "return null;", todos: [" 待办 "] }),
    ).toEqual({
      script: "return null;",
      todos: ["待办"],
    });
    expect(() => read_agent_workspace_runtime_request({ script: " ", todos: [] })).toThrow();
    expect(() =>
      read_agent_workspace_runtime_request({ script: "return null;", todos: [], extra: true }),
    ).toThrow();
    expect(() => read_agent_workspace_runtime_request({ script: "return null;" })).toThrow();
  });
});

function read_port(): AgentWorkspaceReadPort {
  return {
    contract: AGENT_WORKSPACE_CONTRACT,
    iterateJsonl: async function* (file_path: string) {
      if (file_path === "items/entries.jsonl") {
        yield {
          item_id: 1,
          fp: "abcd",
          src: "Alice",
          name_src: "",
          dst: "",
          name_dst: "",
          status: "NONE",
          file_path: "script.txt",
          text_type: "NONE",
          row_number: 0,
          retry_count: 0,
        };
      }
    },
  } satisfies AgentWorkspaceReadPort;
}
