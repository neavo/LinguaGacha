import {
  create_workspace_contract,
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_REFERENCES,
} from "./contract";
import { describe, expect, it } from "vitest";

import { check_typescript } from "../../../test/typescript-fixture";

describe("Agent 工作区 contract", () => {
  it("索引指向包含对应数据路径的参考，各主题声明可独立使用", () => {
    const entries = [
      ...Object.values(AGENT_WORKSPACE_CONTRACT.datasets),
      ...Object.values(AGENT_WORKSPACE_CONTRACT.changes).flatMap(Object.values),
    ];
    for (const entry of entries) {
      expect(AGENT_WORKSPACE_REFERENCES[entry.reference]).toContain(entry.path);
    }
    expect(new Set(entries.map((entry) => entry.reference))).toEqual(
      new Set(Object.keys(AGENT_WORKSPACE_REFERENCES)),
    );
    check_typescript(
      Object.values(AGENT_WORKSPACE_REFERENCES).map((content) => {
        const declaration = content.match(/```ts\n([\s\S]*?)\n```/u)?.[1];
        expect(declaration).toBeDefined();
        return declaration!;
      }),
    );
  });

  it("数据集与变更路径互斥", () => {
    const { datasets, changes } = AGENT_WORKSPACE_CONTRACT;
    const dataset_paths = new Set(Object.values(datasets).map((dataset) => dataset.path));
    const change_paths = Object.values(changes).flatMap((operations) =>
      Object.values(operations).map((entry) => entry.path),
    );

    expect(change_paths.every((change_path) => change_path.startsWith("changes/"))).toBe(true);
    expect(change_paths.every((change_path) => !dataset_paths.has(change_path))).toBe(true);
  });
  it("冻结公开契约而不修改借入数据", () => {
    const contract = structuredClone(AGENT_WORKSPACE_CONTRACT);
    const exposed = create_workspace_contract(contract);
    contract.datasets.items!.path = "changed";
    expect(exposed.datasets.items!.path).toBe(AGENT_WORKSPACE_CONTRACT.datasets.items!.path);
    expect([exposed, exposed.datasets, exposed.datasets.items].every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(contract)).toBe(false);
  });

  it("运行时入口拒绝无效磁盘契约", () => {
    expect(() => create_workspace_contract(null)).toThrow();
  });
});
