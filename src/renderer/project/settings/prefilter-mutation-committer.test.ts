import { describe, expect, it, vi } from "vitest";

import { apply_project_prefilter_mutation } from "./prefilter-mutation-committer";

// api fetch mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

describe("apply_project_prefilter_mutation", () => {
  it("通过统一 mutation 管线提交设置镜像和 section revision 锁", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/project/query/workbench") {
        return {
          sectionRevisions: {
            items: 3,
            analysis: 4,
          },
        };
      }
      return { accepted: true, changes: [] };
    });
    const commit_project_mutation = vi.fn(async (request) => {
      return await request.run();
    });

    await apply_project_prefilter_mutation({
      source_language: "ja",
      target_language: "zh-CN",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: false,
      operation: "settings.prefilter_apply",
      commit_project_mutation,
    });

    expect(commit_project_mutation).toHaveBeenCalledWith({
      operation: "settings.prefilter_apply",
      run: expect.any(Function),
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/query/workbench", {});
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/settings-alignment/apply", {
      mode: "prefiltered_items",
      project_settings: {
        source_language: "ja",
        target_language: "zh-CN",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
      expected_section_revisions: {
        items: 3,
        analysis: 4,
      },
    });
  });
});
