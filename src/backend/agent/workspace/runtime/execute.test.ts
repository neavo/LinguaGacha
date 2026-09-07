import { describe, expect, it, vi } from "vitest";

import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { AGENT_WORKSPACE_DATA_TOOLS } from "./tool/registry";
import { execute_agent_workspace_program } from "./execute";
import type { AgentWorkspaceReadPort } from "./tool/data-tool";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import { workspace_item } from "./tool/test-support";

describe("Agent Workspace Deno runtime", () => {
  it("执行异步脚本并投影冻结的 ws 能力树", async () => {
    const response = await execute_agent_workspace_program(async (ws) => {
      await Promise.resolve();
      return {
        keys: Object.keys(ws).sort(),
        tool_keys: Object.keys(ws.tool).sort(),
        contract_frozen: Object.isFrozen(ws.contract),
        todo_frozen: Object.isFrozen(ws.todo),
        todo_snapshot_frozen: Object.isFrozen(ws.todo.read()),
        tool_frozen: Object.isFrozen(ws.tool),
      };
    }, read_port());

    expect(response).toEqual({
      ok: true,
      result: {
        keys: ["contract", "todo", "tool"],
        tool_keys: [
          ...Object.keys(AGENT_WORKSPACE_DATA_TOOLS),
          "htmlToMarkdown",
          "streamHtmlToMarkdown",
        ].sort(),
        contract_frozen: true,
        todo_frozen: true,
        todo_snapshot_frozen: true,
        tool_frozen: true,
      },
      todos: [],
    });
  });

  it("在脚本内读取基线并以最终有序 Todo 返回写入", async () => {
    await expect(
      execute_agent_workspace_program(
        async (ws) => {
          const before = ws.todo.read();
          ws.todo.write([" 处理目标 ", "核验结果"]);
          return { before, current: ws.todo.read() };
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
      execute_agent_workspace_program(async (ws) => {
        ws.todo.write([" "]);
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

  it("数据工具通过只读文件端口读取真实 contract 路径", async () => {
    const base = read_port();
    const iterate_jsonl = vi.fn(base.iterateJsonl);
    const port: AgentWorkspaceReadPort = { ...base, iterateJsonl: iterate_jsonl };

    await expect(
      execute_agent_workspace_program(async (ws) => {
        return await ws.tool.matchLiterals({
          patterns: [{ key: "alice", text: "alice", case_sensitive: false }],
          max_matches_per_pattern: 0,
        });
      }, port),
    ).resolves.toMatchObject({ ok: true, result: { matched_item_count: 1 } });
    expect(iterate_jsonl).toHaveBeenCalledWith("items/entries.jsonl");
  });

  it("数据工具按模型可见 Schema 拒绝结构外参数", async () => {
    await expect(
      execute_agent_workspace_program(async (ws) => {
        return await (ws.tool.matchLiterals as (args: unknown) => Promise<unknown>)({
          unexpected: true,
        });
      }, read_port()),
    ).resolves.toEqual({
      ok: false,
      message: expect.stringContaining("matchLiterals /patterns:"),
    });
  });

  it("一次读取完整证据后在脚本内聚合，内部结果可超过最终输出上限", async () => {
    const count = 5000;
    const iterate_jsonl = vi.fn(async function* () {
      for (let index = 1; index <= count; index += 1) {
        yield workspace_item(index, { src: "セラ王女とセラ教団", name_src: "セラ" });
      }
    });
    const response = await execute_agent_workspace_program(
      async (ws) => {
        const result = await ws.tool.matchLiterals({
          patterns: [{ key: "root", text: "セラ", case_sensitive: true }],
        });
        const pattern = result.patterns[0]!;
        expect(pattern.matches_complete).toBe(true);
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeGreaterThan(
          AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes,
        );
        return { count: pattern.matched_item_count };
      },
      { contract: AGENT_WORKSPACE_CONTRACT, iterateJsonl: iterate_jsonl },
    );

    expect(response).toEqual({ ok: true, result: { count }, todos: [] });
    expect(iterate_jsonl).toHaveBeenCalledExactlyOnceWith("items/entries.jsonl");
  });
});

/** 提供单条工程事实，供运行时端口与失败封装测试复用。 */
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
