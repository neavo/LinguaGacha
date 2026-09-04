import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";

import { read_json_record, type JsonRecord } from "../../../domain/json";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./runtime/policy";
import {
  AGENT_WORKSPACE_CONTRACT,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
  project_agent_workspace_warning,
} from "./contract";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA } from "./schema";

describe("Agent 工作区 contract", () => {
  it("完整 contract 满足 Deno 与模型声明共用的外壳 Schema", () => {
    expect(Check(AGENT_WORKSPACE_CONTRACT_SCHEMA, AGENT_WORKSPACE_CONTRACT)).toBe(true);
    expect(
      read_json_record(read_json_record(AGENT_WORKSPACE_CONTRACT["effects"])["item_updates"]),
    ).toMatchObject({
      changed_dst: { status: "PROCESSED", retry_count: 0 },
      duplicate_group: { status: "automatic", affected_values: ["NONE", "DUPLICATED"] },
    });
  });

  it("数据集与变更路径互斥，并复用运行时结果上限", () => {
    const datasets = read_json_record(AGENT_WORKSPACE_CONTRACT["datasets"]);
    const changes = read_json_record(AGENT_WORKSPACE_CONTRACT["changes"]);
    const dataset_paths = new Set(
      Object.values(datasets).map((dataset) => String(read_json_record(dataset)["path"])),
    );
    const change_paths = collect_change_paths(changes);

    expect(change_paths.every((change_path) => change_path.startsWith("changes/"))).toBe(true);
    expect(change_paths.every((change_path) => !dataset_paths.has(change_path))).toBe(true);
    expect(read_json_record(AGENT_WORKSPACE_CONTRACT["limits"])["result_bytes"]).toBe(
      AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes,
    );
  });

  it("边界投影保留业务字段并让 warning 只携带证据", () => {
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
      fp: expect.any(String),
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
      project_agent_workspace_quality_entry(
        "glossary",
        {
          entry_id: "term-1",
          src: "姫",
          dst: "公主",
          info: "称谓",
          case_sensitive: false,
        },
        0,
      ),
    ).toMatchObject({ id: "term-1", src: "姫", dst: "公主", info: "称谓", sort: 0 });
  });
});

/** 递归读取 contract 中所有叶子变更描述，不复制质量类型与操作清单。 */
function collect_change_paths(value: JsonRecord): string[] {
  if (typeof value["path"] === "string") return [value["path"]];
  return Object.values(value).flatMap((child) => collect_change_paths(read_json_record(child)));
}
