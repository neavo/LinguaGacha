import { describe, expect, it } from "vitest";

import { QUALITY_RULE_KINDS } from "../../domain/quality";
import { read_json_record } from "../../domain/json";
import {
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_FIELDS,
  AGENT_WORKSPACE_QUALITY_PATHS,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
} from "./agent-workspace-contract";

describe("Agent 工作区 contract", () => {
  it("contract 的路径、字段和可写性只来自导出常量", () => {
    const datasets = read_json_record(AGENT_WORKSPACE_CONTRACT["datasets"]);
    const item_dataset = read_json_record(datasets["items"]);
    const item_fields = read_json_record(item_dataset["fields"]);

    expect(item_dataset["path"]).toBe(AGENT_WORKSPACE_PATHS.items);
    expect(Object.keys(item_fields)).toEqual(AGENT_WORKSPACE_ITEM_FIELDS);
    expect(
      Object.entries(item_fields)
        .filter(([, field]) => read_json_record(field)["writable"] === true)
        .map(([name]) => name),
    ).toEqual(AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS);
    for (const kind of QUALITY_RULE_KINDS) {
      const dataset = read_json_record(datasets[`quality.${kind}`]);
      expect(dataset["path"]).toBe(AGENT_WORKSPACE_QUALITY_PATHS[kind]);
      expect(Object.keys(read_json_record(dataset["fields"]))).toEqual(
        AGENT_WORKSPACE_QUALITY_FIELDS[kind],
      );
    }
  });

  it("item 姓名始终投影为空字符串，quality 不投影功能状态", () => {
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
