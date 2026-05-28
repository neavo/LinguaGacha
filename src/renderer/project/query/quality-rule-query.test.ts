import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_project_quality_rule } from "./quality-rule-query";

describe("quality-rule-query", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("按公开规则类型读取单个质量规则 view", async () => {
    const response = {
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { quality: 5 },
      qualityRule: { enabled: true, entries: [] },
    };
    api_fetch_mock.mockResolvedValue(response);

    await expect(read_project_quality_rule("glossary")).resolves.toBe(response);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/query/quality-rule", {
      rule_type: "glossary",
    });
  });
});
