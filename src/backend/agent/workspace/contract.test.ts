import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";

import type { ProofreadingWarning } from "../../../shared/proofreading/proofreading-types";
import { check_typescript } from "../../../test/typescript-fixture";
import {
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_REFERENCES,
  project_agent_workspace_warning,
} from "./contract";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA, AGENT_WORKSPACE_WARNING_SCHEMA } from "./schema";

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

  it("警告投影满足字段契约并只输出关联证据", () => {
    const warnings: ProofreadingWarning[] = [
      { code: "FOREIGN_CHAR_RESIDUE", target_field: "name_dst", fragments: ["かな"] },
      {
        code: "TEXT_PRESERVE",
        target_field: "name_dst",
        source_fragments: ["{PLAYER}"],
        translation_fragments: [],
      },
      { code: "PUNCTUATION_MISMATCH", target_field: "name_dst" },
      { code: "SIMILARITY", target_field: "dst" },
      { code: "LINE_COUNT_MISMATCH", target_field: "dst" },
      { code: "RETRY_THRESHOLD", target_field: null },
    ];
    const output = project_agent_workspace_warning({
      item_id: 1,
      row_id: "1",
      file_path: "a.txt",
      internal_file_path: null,
      row_number: 1,
      src: "原文",
      dst: "译文",
      name_src: "Alice",
      name_dst: "かな",
      status: "PROCESSED",
      retry_count: 2,
      compressed_src: "原文",
      compressed_dst: "译文",
      glossary_applications: [],
      warnings,
    });
    expect(Check(AGENT_WORKSPACE_WARNING_SCHEMA, output)).toBe(true);
    expect(output).toEqual({ item_id: 1, warnings, glossary_applications: [] });
    expect(
      Check(AGENT_WORKSPACE_WARNING_SCHEMA, {
        ...output,
        warnings: [{ code: "SIMILARITY", target_field: "name_dst" }],
      }),
    ).toBe(false);
  });
});
