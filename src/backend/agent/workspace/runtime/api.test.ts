import { describe, expect, it } from "vitest";
import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { create_agent_workspace_runtime_api } from "./api";

describe("Workspace 应用接口", () => {
  it("冻结公开契约而不修改借入数据", () => {
    const contract = structuredClone(AGENT_WORKSPACE_CONTRACT);
    const ws = create_agent_workspace_runtime_api(contract, "/user-skills");
    contract.datasets.items!.path = "changed";
    expect(ws.contract.datasets.items!.path).toBe(AGENT_WORKSPACE_CONTRACT.datasets.items!.path);
    expect([ws, ws.contract, ws.contract.datasets.items].every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(contract)).toBe(false);
  });

  it("运行时入口拒绝无效磁盘契约", () => {
    expect(() => create_agent_workspace_runtime_api(null, "/user-skills")).toThrow();
  });
});
