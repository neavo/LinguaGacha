import { describe, expect, it } from "vitest";

import { read_json_record } from "../../domain/json";
import { QUALITY_RULE_KINDS } from "../../domain/quality";
import {
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS,
  AGENT_WORKSPACE_QUALITY_FIELDS,
  AGENT_WORKSPACE_RECIPE_PATHS,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
  project_agent_workspace_warning,
} from "./agent-workspace-contract";

describe("Agent 工作区 contract", () => {
  it("contract 完整声明最终路径、字段和可写性", () => {
    const datasets = read_json_record(AGENT_WORKSPACE_CONTRACT["datasets"]);
    expect(new Set(Object.keys(datasets))).toEqual(
      new Set([
        "project_meta",
        "items",
        "warnings",
        "prompts",
        ...QUALITY_RULE_KINDS,
        ...QUALITY_RULE_KINDS.map((kind) => `${kind}_evidence`),
      ]),
    );

    const project_meta = read_json_record(datasets["project_meta"]);
    expect(project_meta).toMatchObject({
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      format: "json",
      writable: false,
    });
    expect(Object.keys(read_json_record(project_meta["fields"]))).toEqual([
      "source_language",
      "target_language",
      "counts",
      "files",
    ]);

    const items = read_json_record(datasets["items"]);
    expect(items).toMatchObject({
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl",
      writable: true,
      writable_fields: AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
    });
    expect(Object.keys(read_json_record(items["fields"]))).toEqual(AGENT_WORKSPACE_ITEM_FIELDS);

    const warnings = read_json_record(datasets["warnings"]);
    expect(warnings).toMatchObject({
      path: AGENT_WORKSPACE_PATHS.warnings,
      format: "jsonl",
      writable: false,
    });
    expect(Object.keys(read_json_record(warnings["fields"]))).toEqual([
      "item_id",
      "warnings",
      "warning_fragments_by_code",
      "glossary_applications",
    ]);

    for (const kind of QUALITY_RULE_KINDS) {
      const entries = read_json_record(datasets[kind]);
      expect(entries).toMatchObject({
        path: AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind],
        format: "jsonl",
        writable: true,
      });
      expect(Object.keys(read_json_record(entries["fields"]))).toEqual(
        AGENT_WORKSPACE_QUALITY_FIELDS[kind],
      );

      const evidence = read_json_record(datasets[`${kind}_evidence`]);
      expect(evidence).toMatchObject({
        path: AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS[kind],
        format: "json",
        writable: false,
      });
      expect(Object.keys(read_json_record(evidence["fields"]))).toEqual(["by_id", "groups"]);
    }

    for (const dataset of Object.values(datasets).map(read_json_record)) {
      expect(Object.keys(read_json_record(dataset["fields"]))).not.toHaveLength(0);
    }
  });

  it("contract 声明脚本 API 与 recipe 源码路径", () => {
    const script_api = read_json_record(AGENT_WORKSPACE_CONTRACT["script_api"]);
    const recipes = read_json_record(AGENT_WORKSPACE_CONTRACT["recipes"]);

    expect(script_api).toMatchObject({ scratch: "scratch/" });
    expect(script_api["methods"]).not.toContain("runRecipe");
    for (const [name, recipe_path] of Object.entries(AGENT_WORKSPACE_RECIPE_PATHS)) {
      expect(read_json_record(recipes[name])).toEqual({
        path: recipe_path,
        purpose: expect.any(String),
        readonly: true,
      });
    }
  });

  it("边界投影保持业务字段并让 warning 只携带证据", () => {
    expect(
      project_agent_workspace_item({
        id: 1,
        src: "原文",
        dst: "",
        name_src: null,
        name_dst: null,
        file_path: "a.txt",
        row: 0,
        status: "NONE",
        retry_count: 0,
      }),
    ).toEqual({
      item_id: 1,
      src: "原文",
      dst: "",
      name_src: "",
      name_dst: "",
      file_path: "a.txt",
      row_number: 0,
      status: "NONE",
      retry_count: 0,
    });
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
    expect(
      project_agent_workspace_quality_entry("glossary", {
        entry_id: "term-1",
        src: "姫",
        dst: "公主",
        info: "称谓",
        case_sensitive: false,
        enabled: true,
        mode: "smart",
      }),
    ).toEqual({ id: "term-1", src: "姫", dst: "公主", info: "称谓", case_sensitive: false });
  });
});
