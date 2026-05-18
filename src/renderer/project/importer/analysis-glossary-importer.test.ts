import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "@base/item";
import type { ProjectStoreState } from "@/project/store/project-store";
import { prepare_analysis_glossary_import } from "@/project/importer/analysis-glossary-importer";

const { quality_statistics_submit_mock } = vi.hoisted(() => {
  return {
    quality_statistics_submit_mock: vi.fn(),
  };
});

vi.mock("@/project/quality/quality-statistics-worker-pool", () => {
  return {
    getSharedQualityStatisticsWorkerPool: () => ({
      submit: quality_statistics_submit_mock,
    }),
  };
});

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_test_state(overrides: Partial<ProjectStoreState> = {}): ProjectStoreState {
  const state: ProjectStoreState = {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: {
      "1": create_test_item({
        item_id: 1,
        file_path: "chapter01.txt",
        src: "艾琳",
        dst: "",
      }),
    },
    quality: {
      glossary: {
        entries: [],
        enabled: true,
        mode: "custom",
        revision: 2,
      },
      pre_replacement: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
      post_replacement: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
      text_preserve: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
    },
    prompts: {
      translation: {
        text: "",
        enabled: false,
        revision: 0,
      },
      analysis: {
        text: "",
        enabled: false,
        revision: 0,
      },
    },
    analysis: {
      candidate_count: 1,
      candidate_aggregate: {
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
      },
    },
    proofreading: {
      revision: 0,
    },
    revisions: {
      projectRevision: 7,
      sections: {
        quality: 12,
        analysis: 3,
      },
    },
  };
  return {
    ...state,
    ...overrides,
  };
}

describe("prepare_analysis_glossary_import", () => {
  beforeEach(() => {
    quality_statistics_submit_mock.mockReset();
    quality_statistics_submit_mock.mockResolvedValue({
      results: {
        "艾琳|1": {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    });
  });

  it("保留只出现一次的候选术语", async () => {
    const prepared_import = await prepare_analysis_glossary_import(create_test_state());

    expect(prepared_import).not.toBeNull();
    expect(quality_statistics_submit_mock).toHaveBeenCalledTimes(1);
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
    expect(quality_statistics_submit_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        relationTargetCandidates: [{ key: "艾琳|1", src: "艾琳" }],
      }),
      {
        stale_key: "quality-statistics:analysis-glossary-importer",
      },
    );
  });

  it("重复候选选择跳过时只消费候选池且不改术语表 revision", async () => {
    const state = create_test_state();
    state.quality.glossary.entries = [
      {
        src: "艾琳",
        dst: "Eileen",
        info: "既有角色名",
        regex: false,
        case_sensitive: true,
      },
    ];

    const prepared_import = await prepare_analysis_glossary_import(state, { action: "skip" });

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

  it("重复候选选择覆盖时用候选术语改写旧值", async () => {
    const state = create_test_state();
    state.quality.glossary.entries = [
      {
        src: "艾琳",
        dst: "Eileen",
        info: "既有角色名",
        regex: false,
        case_sensitive: true,
      },
    ];

    const prepared_import = await prepare_analysis_glossary_import(state, { action: "overwrite" });

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

  it("请求体只携带后端消费候选所需的 src 列表", async () => {
    const state = create_test_state({
      analysis: {
        candidate_count: 2,
        candidate_aggregate: {
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
      },
    });

    const prepared_import = await prepare_analysis_glossary_import(state);

    expect(prepared_import?.consumed_count).toBe(1);
    expect(prepared_import?.request_body.consumed_candidate_srcs).toEqual(["艾琳"]);
  });
});
