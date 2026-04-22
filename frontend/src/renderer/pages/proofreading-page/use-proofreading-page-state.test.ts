import { describe, expect, it } from "vitest";

import { should_refresh_proofreading_cache_for_project } from "@/pages/proofreading-page/use-proofreading-page-state";

describe("should_refresh_proofreading_cache_for_project", () => {
  it("目标工程还没 settled 时会主动触发一次补刷", () => {
    expect(
      should_refresh_proofreading_cache_for_project({
        project_loaded: true,
        project_path: "E:/demo/sample.lg",
        cache_status: "refreshing",
        is_refreshing: false,
        settled_project_path: "",
      }),
    ).toBe(true);
  });

  it("已经在刷新中的重复渲染不会再次触发补刷", () => {
    expect(
      should_refresh_proofreading_cache_for_project({
        project_loaded: true,
        project_path: "E:/demo/sample.lg",
        cache_status: "refreshing",
        is_refreshing: true,
        settled_project_path: "",
      }),
    ).toBe(false);
  });

  it("当前工程已经 settled 后不会重复补刷", () => {
    expect(
      should_refresh_proofreading_cache_for_project({
        project_loaded: true,
        project_path: "E:/demo/sample.lg",
        cache_status: "refreshing",
        is_refreshing: false,
        settled_project_path: "E:/demo/sample.lg",
      }),
    ).toBe(false);
  });
});
