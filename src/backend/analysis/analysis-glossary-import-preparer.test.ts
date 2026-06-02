import { describe, expect, it } from "vitest";

import {
  prepare_analysis_glossary_import_from_cache,
  type AnalysisGlossaryImportPrepareRequest,
} from "../analysis/analysis-glossary-import-preparer";
import type { ProjectDataRecord } from "../project/project-data";

const CANDIDATE_AGGREGATE: Record<string, unknown> = {
  艾琳: {
    src: "艾琳",
    dst_votes: {
      Erin: 1,
    },
    info_votes: {
      角色名: 1,
    },
    case_sensitive: true,
  },
};

function create_test_item(overrides: ProjectDataRecord = {}): ProjectDataRecord {
  return {
    item_id: 1,
    src: "艾琳",
    dst: "",
    file_path: "chapter01.txt",
    row_number: 1,
    file_type: "TXT",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    ...overrides,
  };
}

function create_prepare_request(
  overrides: Partial<AnalysisGlossaryImportPrepareRequest> = {},
): AnalysisGlossaryImportPrepareRequest {
  return {
    quality_block: {
      glossary: {
        entries: [],
        enabled: true,
        mode: "custom",
        revision: 2,
      },
    },
    items: [create_test_item()],
    section_revisions: {
      quality: 12,
      analysis: 3,
    },
    candidate_aggregate: CANDIDATE_AGGREGATE,
    ...overrides,
  };
}

describe("prepare_analysis_glossary_import_from_cache", () => {
  it("保留只出现一次的候选术语", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(create_prepare_request());

    expect(prepared_import).not.toBeNull();
    expect(prepared_import?.duplicate_count).toBe(0);
    expect(prepared_import?.imported_count).toBe(1);
    expect(prepared_import?.consumed_count).toBe(1);
    expect(prepared_import?.quality_changed).toBe(true);
    expect(prepared_import?.updated_sections).toEqual(["quality", "analysis"]);
    expect(prepared_import?.request_body.entries).toEqual([
      {
        src: "艾琳",
        dst: "Erin",
        info: "角色名",
        regex: false,
        case_sensitive: true,
      },
    ]);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳"]);
    expect(prepared_import?.request_body.expected_section_revisions).toEqual({
      quality: 12,
      analysis: 3,
    });
  });

  it("重复候选选择跳过时只消费候选池且不改术语表 revision", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(
      create_prepare_request({
        action: "skip",
        quality_block: {
          glossary: {
            entries: [
              {
                src: "艾琳",
                dst: "Eileen",
                info: "既有角色名",
                regex: false,
                case_sensitive: true,
              },
            ],
          },
        },
      }),
    );

    expect(prepared_import).not.toBeNull();
    expect(prepared_import?.duplicate_count).toBe(1);
    expect(prepared_import?.imported_count).toBe(0);
    expect(prepared_import?.consumed_count).toBe(1);
    expect(prepared_import?.quality_changed).toBe(false);
    expect(prepared_import?.updated_sections).toEqual(["analysis"]);
    expect(prepared_import?.request_body.entries).toEqual([
      {
        src: "艾琳",
        dst: "Eileen",
        info: "既有角色名",
        regex: false,
        case_sensitive: true,
      },
    ]);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳"]);
  });

  it("重复候选选择覆盖时用候选术语改写旧值", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(
      create_prepare_request({
        action: "overwrite",
        quality_block: {
          glossary: {
            entries: [
              {
                src: "艾琳",
                dst: "Eileen",
                info: "既有角色名",
                regex: false,
                case_sensitive: true,
              },
            ],
          },
        },
      }),
    );

    expect(prepared_import).not.toBeNull();
    expect(prepared_import?.duplicate_count).toBe(1);
    expect(prepared_import?.imported_count).toBe(1);
    expect(prepared_import?.quality_changed).toBe(true);
    expect(prepared_import?.request_body.entries).toEqual([
      {
        src: "艾琳",
        dst: "Erin",
        info: "角色名",
        regex: false,
        case_sensitive: true,
      },
    ]);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳"]);
  });

  it("导入请求消费本轮候选池而不是只消费写入术语表的子集", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(
      create_prepare_request({
        candidate_aggregate: {
          ...CANDIDATE_AGGREGATE,
          王: {
            src: "王",
            dst_votes: {
              King: 1,
            },
            info_votes: {
              角色名: 1,
            },
            case_sensitive: false,
          },
        },
      }),
    );

    expect(prepared_import?.consumed_count).toBe(2);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳", "王"]);
  });

  it("候选全被统计过滤时仍返回 analysis-only 消费请求", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(
      create_prepare_request({
        items: [create_test_item({ src: "无关文本" })],
      }),
    );

    expect(prepared_import).not.toBeNull();
    expect(prepared_import?.imported_count).toBe(0);
    expect(prepared_import?.consumed_count).toBe(1);
    expect(prepared_import?.quality_changed).toBe(false);
    expect(prepared_import?.updated_sections).toEqual(["analysis"]);
    expect(prepared_import?.request_body.entries).toEqual([]);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳"]);
  });

  it("候选只出现在姓名字段中时仍保留导入", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(
      create_prepare_request({
        items: [create_test_item({ src: "无关正文", name_src: ["艾琳", "隐藏姓名"] })],
      }),
    );

    expect(prepared_import).not.toBeNull();
    expect(prepared_import?.imported_count).toBe(1);
    expect(prepared_import?.request_body.entries).toEqual([
      {
        src: "艾琳",
        dst: "Erin",
        info: "角色名",
        regex: false,
        case_sensitive: true,
      },
    ]);
  });

  it("候选全被静态规则过滤时仍消费候选池", () => {
    const prepared_import = prepare_analysis_glossary_import_from_cache(
      create_prepare_request({
        candidate_aggregate: {
          艾琳: {
            src: "艾琳",
            dst_votes: {
              Erin: 1,
            },
            info_votes: {
              其他: 1,
            },
            case_sensitive: true,
          },
        },
      }),
    );

    expect(prepared_import).not.toBeNull();
    expect(prepared_import?.imported_count).toBe(0);
    expect(prepared_import?.consumed_count).toBe(1);
    expect(prepared_import?.request_body.entries).toEqual([]);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳"]);
  });
});
