import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_project_section_revisions } from "./project-section-revisions-query";

describe("project-section-revisions-query", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("从 workbench query 读取页面 mutation 依赖 revision", async () => {
    api_fetch_mock.mockResolvedValue({ sectionRevisions: { items: 3 } });

    await expect(read_project_section_revisions()).resolves.toEqual({ items: 3 });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/query/workbench", {});
  });

  it("缺少 revision 时返回空对象", async () => {
    api_fetch_mock.mockResolvedValue({});

    await expect(read_project_section_revisions()).resolves.toEqual({});
  });
});
