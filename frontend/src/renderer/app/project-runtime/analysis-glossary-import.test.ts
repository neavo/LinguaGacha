import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import { create_analysis_glossary_import_plan } from "@/app/project-runtime/analysis-glossary-import";

const { quality_statistics_submit_mock } = vi.hoisted(() => {
  return {
    quality_statistics_submit_mock: vi.fn(),
  };
});

vi.mock("@/app/project-runtime/quality-statistics-worker-pool", () => {
  return {
    getSharedQualityStatisticsWorkerPool: () => ({
      submit: quality_statistics_submit_mock,
    }),
  };
});

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: {
      "1": {
        item_id: 1,
        file_path: "chapter01.txt",
        src: "艾琳",
        dst: "",
      },
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
    task: {
      task_type: "analysis",
      status: "DONE",
      busy: false,
      analysis_candidate_count: 1,
    },
    revisions: {
      projectRevision: 7,
      sections: {
        quality: 12,
        analysis: 3,
      },
    },
  };
}

describe("create_analysis_glossary_import_plan", () => {
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
    const import_plan = await create_analysis_glossary_import_plan(create_test_state());

    expect(import_plan).not.toBeNull();
    expect(quality_statistics_submit_mock).toHaveBeenCalledTimes(1);
    expect(import_plan?.imported_count).toBe(1);
    expect(import_plan?.request_body.entries).toEqual([
      {
        src: "艾琳",
        dst: "Erin",
        info: "角色名",
        case_sensitive: true,
      },
    ]);
    expect(import_plan?.request_body.analysis_candidate_count).toBe(0);
    expect(import_plan?.request_body.expected_glossary_revision).toBe(2);
    expect(import_plan?.request_body.expected_section_revisions).toEqual({
      quality: 12,
      analysis: 3,
    });
    expect(quality_statistics_submit_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        relationTargetCandidates: [{ key: "艾琳|1", src: "艾琳" }],
      }),
      {
        stale_key: "quality-statistics:analysis-glossary-import",
      },
    );
  });
});
