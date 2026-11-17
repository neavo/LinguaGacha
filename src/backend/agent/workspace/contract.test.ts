import { AGENT_WORKSPACE_CONTRACT, format_agent_workspace_contract_prompt } from "./contract";
import { describe, expect, it } from "vitest";

import { QUALITY_RULE_KINDS } from "../../../domain/quality";
import { check_typescript } from "../../../test/typescript-fixture";

describe("Agent 工作区 contract", () => {
  it("system 契约覆盖全部路径入口且声明可编译", () => {
    const prompt = format_agent_workspace_contract_prompt();
    expect(prompt.match(/<workspace_contract>/gu)).toHaveLength(1);
    expect(prompt.match(/<\/workspace_contract>/gu)).toHaveLength(1);
    for (const name of Object.keys(AGENT_WORKSPACE_CONTRACT.datasets))
      expect(prompt).toContain(`${name}: Dataset_${name};`);
    for (const [name, operations] of Object.entries(AGENT_WORKSPACE_CONTRACT.changes)) {
      if ((QUALITY_RULE_KINDS as readonly string[]).includes(name)) {
        expect(prompt).toContain(`${name}: QualityChanges<"${name}">;`);
        continue;
      }
      for (const operation of Object.keys(operations))
        expect(prompt).toContain(`${operation}: Change_${name}_${operation};`);
    }
    expect(prompt).not.toContain("type Change_glossary_creates");

    const declaration = prompt.match(/```ts\n([\s\S]*?)\n```/u)?.[1];
    expect(declaration).toBeDefined();
    check_typescript([declaration!]);
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

  it("递归冻结公开路径索引", () => {
    const { datasets, changes } = AGENT_WORKSPACE_CONTRACT;
    expect(
      [
        AGENT_WORKSPACE_CONTRACT,
        datasets,
        ...Object.values(datasets),
        changes,
        ...Object.values(changes),
        ...Object.values(changes).flatMap(Object.values),
      ].every(Object.isFrozen),
    ).toBe(true);
  });
});
