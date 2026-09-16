import { describe, expect, it, vi } from "vitest";
import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { create_agent_workspace_runtime_api } from "./api";
import { workspace_item } from "./tool/test-support";

describe("Workspace 应用接口", () => {
  it("冻结契约与 Todo 副本，规范化写入并向宿主发送独立快照", () => {
    const write = vi.fn();
    const ws = create_agent_workspace_runtime_api(read_port(), ["发现目标"], write);
    expect([ws, ws.contract, ws.todo, ws.todo.read(), ws.tool].every(Object.isFrozen)).toBe(true);
    const before = ws.todo.read();
    const next = [" 处理目标 ", "核验结果"];
    ws.todo.write(next);
    next[0] = "调用者修改";
    expect(before).toEqual(["发现目标"]);
    expect(ws.todo.read()).toEqual(["处理目标", "核验结果"]);
    expect(write).toHaveBeenCalledWith(["处理目标", "核验结果"]);
    expect(() => ws.todo.write([" "])).toThrow();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("数据工具从 contract 指定的快照读取，并校验跨边界参数", async () => {
    const port = read_port();
    const iterateJsonl = vi.fn(port.iterateJsonl);
    const ws = create_agent_workspace_runtime_api({ ...port, iterateJsonl }, [], () => undefined);
    await expect(
      ws.tool.matchLiterals({ patterns: [{ key: "alice", text: "alice", case_sensitive: false }] }),
    ).resolves.toMatchObject({ matched_item_count: 1 });
    expect(iterateJsonl).toHaveBeenCalledWith("items/entries.jsonl");
    await expect(ws.tool.matchLiterals(null as never)).rejects.toThrow("matchLiterals /");
    expect(() =>
      create_agent_workspace_runtime_api({ ...port, contract: null }, [], () => undefined),
    ).toThrow();
  });
});

/** 按真实契约路径供给一条可查询事实。 */
function read_port() {
  return {
    contract: AGENT_WORKSPACE_CONTRACT,
    iterateJsonl: async function* (file: string) {
      if (file === "items/entries.jsonl") yield workspace_item(1, { src: "Alice" });
    },
  };
}
