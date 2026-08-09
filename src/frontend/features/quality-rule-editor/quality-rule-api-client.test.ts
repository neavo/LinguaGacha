import { beforeEach, describe, expect, it, vi } from "vitest";

const { api_fetch_mock } = vi.hoisted(() => ({
  api_fetch_mock: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

import { import_quality_rule_entries, read_quality_rule_snapshot } from "./quality-rule-api-client";

describe("quality rule api client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it.each(["glossary", "pre_replacement", "post_replacement", "text_preserve"] as const)(
    "读取 %s 规则视图",
    async (rule_type) => {
      const response = { projectPath: "E:/demo/demo.lg" };
      api_fetch_mock.mockResolvedValue(response);

      await expect(read_quality_rule_snapshot(rule_type)).resolves.toBe(response);
      expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/query", { rule_type });
    },
  );

  it("导入规则时只返回数组 entries", async () => {
    const entries = [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }];
    api_fetch_mock.mockResolvedValueOnce({ entries }).mockResolvedValueOnce({ entries: null });

    await expect(import_quality_rule_entries("glossary", "E:/rules.json")).resolves.toBe(entries);
    await expect(import_quality_rule_entries("glossary", "E:/bad.json")).resolves.toEqual([]);
    expect(api_fetch_mock).toHaveBeenNthCalledWith(1, "/api/quality/rules/import", {
      rule_type: "glossary",
      path: "E:/rules.json",
    });
  });
});
