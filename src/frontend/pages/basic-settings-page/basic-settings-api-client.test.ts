import { describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { apply_basic_settings_prefilter_write } from "./basic-settings-api-client";

describe("basic-settings-api-client", () => {
  it("通过基础设置页写入管线提交设置镜像和 section revision 锁", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/workbench/snapshot") {
        return {
          sectionRevisions: {
            items: 3,
            analysis: 4,
          },
        };
      }
      return { accepted: true, changes: [] };
    });
    const commit_project_write = vi.fn(async (request) => {
      return await request.run();
    });

    await apply_basic_settings_prefilter_write({
      source_language: "ja",
      target_language: "zh-CN",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: false,
      commit_project_write,
    });

    expect(commit_project_write).toHaveBeenCalledWith({
      operation: "basic-settings.prefilter_settings",
      run: expect.any(Function),
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/snapshot", {});
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/settings-alignment/apply", {
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
