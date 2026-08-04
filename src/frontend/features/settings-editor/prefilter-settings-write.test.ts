import { describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: api_fetch_mock }));

import { apply_prefilter_settings_write } from "./prefilter-settings-write";

describe("apply_prefilter_settings_write", () => {
  it("提交设置镜像和 section revision 锁", async () => {
    api_fetch_mock.mockImplementation(async (path: string) =>
      path === "/api/workbench/snapshot"
        ? { sectionRevisions: { items: 3, analysis: 4 } }
        : { accepted: true, changes: [] },
    );
    const commit_project_write = vi.fn(async (request) => await request.run());

    await apply_prefilter_settings_write({
      operation: "laboratory.prefilter_settings",
      settings: {
        source_language: "ja",
        target_language: "zh-CN",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
      commit_project_write,
    });

    expect(commit_project_write).toHaveBeenCalledWith({
      operation: "laboratory.prefilter_settings",
      run: expect.any(Function),
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/settings-alignment/apply", {
      mode: "prefiltered_items",
      project_settings: {
        source_language: "ja",
        target_language: "zh-CN",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
      expected_section_revisions: { items: 3, analysis: 4 },
    });
  });
});
