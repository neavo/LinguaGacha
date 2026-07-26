import { beforeEach, describe, expect, it, vi } from "vitest";

const { api_fetch_mock } = vi.hoisted(() => ({
  api_fetch_mock: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

import { read_quality_rule, read_quality_rule_section_revisions } from "./quality-rule-api-client";

describe("quality rule api client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it.each(["glossary", "pre_replacement", "post_replacement", "text_preserve"] as const)(
    "读取 %s 规则视图",
    async (rule_type) => {
      const response = { projectPath: "E:/demo/demo.lg" };
      api_fetch_mock.mockResolvedValue(response);

      await expect(read_quality_rule(rule_type)).resolves.toBe(response);
      expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/view", { rule_type });
    },
  );

  it("读取写入所需的 section revisions", async () => {
    api_fetch_mock.mockResolvedValue({ sectionRevisions: { quality: 5 } });

    await expect(read_quality_rule_section_revisions()).resolves.toEqual({ quality: 5 });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/snapshot", {});
  });
});
