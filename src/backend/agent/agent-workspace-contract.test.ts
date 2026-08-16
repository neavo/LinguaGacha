import { describe, expect, it } from "vitest";

import { ITEM_TEXT_TYPES } from "../../domain/item";
import { read_json_record } from "../../domain/json";
import { QUALITY_RULE_KINDS } from "../../domain/quality";
import {
  AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  AGENT_WORKSPACE_MAX_RESULT_BYTES,
} from "../../shared/backend-runtime";
import {
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_FIELDS,
  AGENT_WORKSPACE_RECIPE_PATHS,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
  project_agent_workspace_warning,
} from "./agent-workspace-contract";

describe("Agent 工作区 contract", () => {
  it("contract 把只读快照与显式 change 路径分开声明", () => {
    const datasets = read_json_record(AGENT_WORKSPACE_CONTRACT["datasets"]);
    expect(new Set(Object.keys(datasets))).toEqual(
      new Set(["project_meta", "items", "warnings", "prompts", ...QUALITY_RULE_KINDS]),
    );

    const project_meta = read_json_record(datasets["project_meta"]);
    expect(project_meta).toMatchObject({
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      format: "json",
    });
    const project_meta_fields = read_json_record(project_meta["fields"]);
    expect(Object.keys(project_meta_fields)).toEqual([
      "source_language",
      "target_language",
      "counts",
      "files",
    ]);
    const project_file_items = read_json_record(
      read_json_record(project_meta_fields["files"])["items"],
    );
    expect(read_json_record(project_file_items["fields"])).toMatchObject({
      source_text_path: { type: "string", optional: true },
      source_text_root: { type: "string", optional: true },
    });

    const items = read_json_record(datasets["items"]);
    expect(items).toMatchObject({
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl",
    });
    expect(Object.keys(read_json_record(items["fields"]))).toEqual(AGENT_WORKSPACE_ITEM_FIELDS);
    expect(read_json_record(read_json_record(items["fields"])["text_type"])).toMatchObject({
      type: "enum",
      values: [...ITEM_TEXT_TYPES],
    });

    const warnings = read_json_record(datasets["warnings"]);
    expect(warnings).toMatchObject({
      path: AGENT_WORKSPACE_PATHS.warnings,
      format: "jsonl",
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
      });
      expect(Object.keys(read_json_record(entries["fields"]))).toEqual(
        AGENT_WORKSPACE_QUALITY_FIELDS[kind],
      );
    }

    for (const dataset of Object.values(datasets).map(read_json_record)) {
      expect(dataset).not.toHaveProperty("writable");
      expect(Object.keys(read_json_record(dataset["fields"]))).not.toHaveLength(0);
    }

    const changes = read_json_record(AGENT_WORKSPACE_CONTRACT["changes"]);
    const item_updates = read_json_record(read_json_record(changes["items"])["updates"]);
    expect(item_updates).toMatchObject({
      path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      require_one_of: AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
    });
    expect(Object.keys(read_json_record(item_updates["fields"]))).toEqual([
      "item_id",
      ...AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
    ]);
    expect(read_json_record(read_json_record(changes["prompts"])["updates"])).toMatchObject({
      path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
    });
    for (const kind of QUALITY_RULE_KINDS) {
      const operations = read_json_record(changes[kind]);
      expect(Object.keys(operations)).toEqual(["creates", "updates", "deletes", "moves"]);
      for (const operation of Object.keys(operations)) {
        expect(read_json_record(operations[operation])).toMatchObject({
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][
            operation as keyof (typeof AGENT_WORKSPACE_QUALITY_CHANGE_PATHS)[typeof kind]
          ],
          format: "jsonl",
        });
      }
    }
  });

  it("contract 对齐共享硬限制、保留 recipe 且不声明固定脚本 SDK", () => {
    const limits = read_json_record(AGENT_WORKSPACE_CONTRACT["limits"]);
    const recipes = read_json_record(AGENT_WORKSPACE_CONTRACT["recipes"]);

    expect(limits).toMatchObject({
      result_bytes: AGENT_WORKSPACE_MAX_RESULT_BYTES,
      literal_match_examples_max: AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
    });
    expect(AGENT_WORKSPACE_CONTRACT).not.toHaveProperty("script_api");
    for (const [name, recipe_path] of Object.entries(AGENT_WORKSPACE_RECIPE_PATHS)) {
      expect(read_json_record(recipes[name])).toMatchObject({
        path: recipe_path,
        purpose: expect.any(String),
        parameters: expect.any(Object),
        returns: expect.any(String),
      });
    }
  });

  it("contract 为无 skill 写入声明 item 副作用与领域提交软建议", () => {
    const effects = read_json_record(AGENT_WORKSPACE_CONTRACT["effects"]);
    const item_effects = read_json_record(effects["item_updates"]);
    const guidance = read_json_record(AGENT_WORKSPACE_CONTRACT["guidance"]);
    const apply_guidance = read_json_record(guidance["apply"]);

    expect(item_effects).toEqual({
      non_empty_dst: { status: "PROCESSED" },
      empty_dst: { status: "preserve" },
      name_dst: { status: "preserve", retry_count: "preserve" },
      explicit_status: { precedence: "after_dst", retry_count: 0 },
    });
    const item_guidance = read_json_record(apply_guidance["item_updates"]);
    expect(item_guidance["preferred_max_rows"]).toEqual(expect.any(Number));
    expect(item_guidance["preferred_max_rows"]).toBeGreaterThan(0);
    expect(item_guidance["hard_max_rows"]).toBeNull();
    expect(read_json_record(apply_guidance["quality_changes"])).toEqual({
      preferred_max_rows: null,
      hard_max_rows: null,
    });
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
        text_type: "RENPY",
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
      text_type: "RENPY",
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
