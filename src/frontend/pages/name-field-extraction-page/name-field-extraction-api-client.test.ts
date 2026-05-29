import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import {
  read_name_field_extraction_query,
  read_name_field_extraction_section_revisions,
} from "./name-field-extraction-api-client";

describe("name-field-extraction-api-client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("读取姓名字段提取需要的后端 query view", async () => {
    const response = {
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 2, quality: 4 },
      view: {
        rows: [{ id: "Alice", src: "Alice", dst: "", context: "Alice", status: "untranslated" }],
        counts: { total: 1, translated: 0, untranslated: 1, error: 0 },
        invalid_regex_message: null,
      },
    };
    api_fetch_mock.mockResolvedValue(response);

    const filter = { keyword: "", scope: "all", is_regex: false } as const;
    const sort = { field: null, direction: null } as const;

    await expect(read_name_field_extraction_query({ filter, sort })).resolves.toBe(response);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/toolbox/name-fields/view", {
      filter,
      sort,
    });
  });

  it("读取姓名字段提取页提交依赖 revision", async () => {
    api_fetch_mock.mockResolvedValue({ sectionRevisions: { quality: 5 } });

    await expect(read_name_field_extraction_section_revisions()).resolves.toEqual({ quality: 5 });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/view", {});
  });
});
