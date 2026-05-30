import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import {
  read_text_replacement_quality_rule,
  read_text_replacement_section_revisions,
} from "./text-replacement-api-client";

describe("text-replacement-api-client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("读取替换规则 view", async () => {
    const response = {
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { quality: 5 },
      qualityRule: { enabled: true, entries: [] },
    };
    api_fetch_mock.mockResolvedValue(response);

    await expect(read_text_replacement_quality_rule("pre_replacement")).resolves.toBe(response);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/view", {
      rule_type: "pre_replacement",
    });
  });

  it("读取替换规则保存依赖 revision", async () => {
    api_fetch_mock.mockResolvedValue({ sectionRevisions: { quality: 5 } });

    await expect(read_text_replacement_section_revisions()).resolves.toEqual({ quality: 5 });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/snapshot", {});
  });
});
