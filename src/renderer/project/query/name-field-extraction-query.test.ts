import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_name_field_extraction_query } from "./name-field-extraction-query";

describe("name-field-extraction-query", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("读取姓名字段提取需要的后端 query view", async () => {
    const response = {
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 2, quality: 4 },
      items: [{ item_id: 1, src: "Alice", dst: "" }],
      glossary: { entries: [] },
    };
    api_fetch_mock.mockResolvedValue(response);

    await expect(read_name_field_extraction_query()).resolves.toBe(response);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/query/name-field-extraction", {});
  });
});
