import { beforeEach, describe, expect, it, vi } from "vitest";

const { api_fetch_mock } = vi.hoisted(() => ({
  api_fetch_mock: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

import { query_quality_rules } from "./quality-rule-api-client";

describe("quality rule api client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it.each(["glossary", "pre_replacement", "post_replacement", "text_preserve"] as const)(
    "读取 %s 规则视图",
    async (rule_type) => {
      const response = { projectPath: "E:/demo/demo.lg" };
      api_fetch_mock.mockResolvedValue(response);

      await expect(query_quality_rules(rule_type)).resolves.toBe(response);
      expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/query", { rule_type });
    },
  );
});
