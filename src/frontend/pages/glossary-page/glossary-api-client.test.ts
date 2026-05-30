import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_glossary_quality_rule, read_glossary_section_revisions } from "./glossary-api-client";

describe("glossary-api-client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("读取术语表规则 view", async () => {
    const response = {
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { quality: 5 },
      qualityRule: { enabled: true, entries: [] },
    };
    api_fetch_mock.mockResolvedValue(response);

    await expect(read_glossary_quality_rule()).resolves.toBe(response);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/view", {
      rule_type: "glossary",
    });
  });

  it("读取术语表保存依赖 revision", async () => {
    api_fetch_mock.mockResolvedValue({ sectionRevisions: { quality: 5 } });

    await expect(read_glossary_section_revisions()).resolves.toEqual({ quality: 5 });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/snapshot", {});
  });
});
