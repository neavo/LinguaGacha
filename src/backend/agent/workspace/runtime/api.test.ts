import { describe, expect, it, vi } from "vitest";
import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { create_agent_workspace_runtime_api } from "./api";

describe("Workspace 应用接口", () => {
  it("冻结契约与 Todo 副本，规范化写入并向宿主发送独立快照", () => {
    const write = vi.fn();
    const contract = structuredClone(AGENT_WORKSPACE_CONTRACT);
    const ws = create_agent_workspace_runtime_api(contract, "/user-skills", ["发现目标"], write);
    contract.datasets.items.path = "changed";
    expect(ws.contract.datasets.items.path).toBe(AGENT_WORKSPACE_CONTRACT.datasets.items.path);
    expect([ws, ws.contract, ws.todo, ws.todo.read()].every(Object.isFrozen)).toBe(true);
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

  it("运行时入口拒绝无效磁盘契约", () => {
    expect(() =>
      create_agent_workspace_runtime_api(null, "/user-skills", [], () => undefined),
    ).toThrow();
  });
});
