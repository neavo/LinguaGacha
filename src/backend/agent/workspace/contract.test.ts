import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";

import { check_typescript } from "../../../test/typescript-fixture";
import {
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_REFERENCES,
  project_agent_workspace_warning,
} from "./contract";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA } from "./schema";

describe("Agent 工作区 contract", () => {
  it("轻量 contract 满足 Node 与模型声明共用的外壳 Schema", () => {
    expect(Check(AGENT_WORKSPACE_CONTRACT_SCHEMA, AGENT_WORKSPACE_CONTRACT)).toBe(true);
  });

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

  it("warning 投影只携带校对证据", () => {
    expect(
      project_agent_workspace_warning({
        item_id: 1,
        file_path: "a.txt",
        row_number: 0,
        src: "原文",
        dst: "译文",
        name_src: null,
        name_dst: null,
        status: "PROCESSED",
        retry_count: 0,
        row_id: "item:1",
        compressed_src: "原文",
        compressed_dst: "译文",
        warnings: ["GLOSSARY"],
        warning_fragments_by_code: {},
        glossary_applications: [],
      }),
    ).toEqual({
      item_id: 1,
      warnings: ["GLOSSARY"],
      warning_fragments_by_code: {},
      glossary_applications: [],
    });
  });
});
