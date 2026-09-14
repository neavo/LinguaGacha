import { describe, expect, it, vi } from "vitest";

import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { execute_agent_workspace_script } from "./execute";
import type { AgentWorkspaceReadPort } from "./tool/data-tool";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import { workspace_item } from "./tool/test-support";

describe("Agent Workspace JavaScript 执行", () => {
  it("脚本获得冻结的契约、Todo 与工具树", async () => {
    await expect(
      execute_agent_workspace_script(
        `
      await Promise.resolve();
      return [ws.contract, ws.todo, ws.todo.read(), ws.tool].every(Object.isFrozen);
    `,
        read_port(),
        [],
      ),
    ).resolves.toEqual({ ok: true, result: true, todos: [] });
  });

  it("从基线读取 Todo，以最终有序副本返回写入", async () => {
    await expect(
      execute_agent_workspace_script(
        `
      const before = ws.todo.read();
      ws.todo.write([" 处理目标 ", "核验结果"]);
      return { before, current: ws.todo.read() };
    `,
        read_port(),
        ["发现目标", "处理目标"],
      ),
    ).resolves.toEqual({
      ok: true,
      result: { before: ["发现目标", "处理目标"], current: ["处理目标", "核验结果"] },
      todos: ["处理目标", "核验结果"],
    });
  });

  it.each([
    ["语法错误", "const value: number = 1; return value;"],
    ["运行异常", 'throw new Error("boom");'],
    ["未返回", "await Promise.resolve();"],
    ["循环引用", "const value = {}; value.self = value; return value;"],
    ["BigInt", "return 1n;"],
    // 中文的 UTF-8 字节数超过字符数，防止把长度上限误实现为字符数限制。
    [
      "超大 UTF-8 结果",
      `return "汉".repeat(${Math.floor(AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes / 3) + 1});`,
    ],
    ["非法 Todo", 'ws.todo.write([" "]); return null;'],
  ])("把%s投影为失败回包", async (_label, script) => {
    const response = await execute_agent_workspace_script(script, read_port(), []);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.message).not.toBe("");
  });

  it("数据工具按真实 contract 路径读取，并由 Schema 校验脚本参数", async () => {
    const base = read_port();
    const iterate_jsonl = vi.fn(base.iterateJsonl);
    await expect(
      execute_agent_workspace_script(
        `
      return await ws.tool.matchLiterals({
        patterns: [{ key: "alice", text: "alice", case_sensitive: false }], max_matches_per_pattern: 0,
      });
    `,
        { ...base, iterateJsonl: iterate_jsonl },
        [],
      ),
    ).resolves.toMatchObject({ ok: true, result: { matched_item_count: 1 } });
    expect(iterate_jsonl).toHaveBeenCalledWith("items/entries.jsonl");
    for (const args of ["{ unexpected: true }", "null"]) {
      await expect(
        execute_agent_workspace_script(`return await ws.tool.matchLiterals(${args});`, base, []),
      ).resolves.toEqual({
        ok: false,
        message: expect.stringContaining("matchLiterals /"),
      });
    }
    await expect(
      execute_agent_workspace_script("return null;", { ...base, contract: null }, []),
    ).resolves.toMatchObject({ ok: false });
  });

  it("完整证据在脚本内聚合，最终输出上限不限制内部结果", async () => {
    const count = 5000;
    const iterate_jsonl = vi.fn(async function* () {
      for (let index = 1; index <= count; index += 1)
        yield workspace_item(index, { src: "セラ王女とセラ教団", name_src: "セラ" });
    });
    const response = await execute_agent_workspace_script(
      `
      const result = await ws.tool.matchLiterals({ patterns: [{ key: "root", text: "セラ", case_sensitive: true }] });
      return { count: result.patterns[0].matched_item_count, complete: result.patterns[0].matches_complete,
        bytes: new TextEncoder().encode(JSON.stringify(result)).byteLength };
    `,
      { contract: AGENT_WORKSPACE_CONTRACT, iterateJsonl: iterate_jsonl },
      [],
    );
    expect(response).toMatchObject({ ok: true, result: { count, complete: true } });
    if (response.ok)
      expect((response.result as { bytes: number }).bytes).toBeGreaterThan(
        AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes,
      );
    expect(iterate_jsonl).toHaveBeenCalledExactlyOnceWith("items/entries.jsonl");
  });
});

/** 单条事实只在 contract 指定的数据集中出现，验证工具确实通过文件端口取数。 */
function read_port(): AgentWorkspaceReadPort {
  return {
    contract: AGENT_WORKSPACE_CONTRACT,
    iterateJsonl: async function* (file_path: string) {
      if (file_path === "items/entries.jsonl") yield workspace_item(1, { src: "Alice" });
    },
  };
}
