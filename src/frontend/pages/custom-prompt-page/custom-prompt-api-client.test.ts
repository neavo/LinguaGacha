import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_custom_prompt_section_revisions } from "./custom-prompt-api-client";

describe("custom-prompt-api-client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("读取自定义提示词保存依赖 revision", async () => {
    api_fetch_mock.mockResolvedValue({ sectionRevisions: { prompts: 8 } });

    await expect(read_custom_prompt_section_revisions()).resolves.toEqual({ prompts: 8 });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/snapshot", {});
  });

  it("后端未返回 revision 时使用空对象", async () => {
    api_fetch_mock.mockResolvedValue({});

    await expect(read_custom_prompt_section_revisions()).resolves.toEqual({});
  });
});
