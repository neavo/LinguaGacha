import { describe, expect, it } from "vitest";

import {
  normalize_section_array,
  normalize_section_revisions,
  normalize_string_array,
  parse_event_payload,
} from "./desktop-event-payload";

describe("desktop-event-payload", () => {
  it("解析 SSE payload 失败时返回空对象", () => {
    expect(parse_event_payload({ data: '{"projectPath":"demo"}' } as MessageEvent<string>)).toEqual(
      {
        projectPath: "demo",
      },
    );
    expect(parse_event_payload({ data: "broken" } as MessageEvent<string>)).toEqual({});
  });

  it("归一化字符串数组并过滤空白项", () => {
    expect(normalize_string_array([" items ", "", null, "quality"])).toEqual(["items", "quality"]);
    expect(normalize_section_array("items")).toEqual([]);
  });

  it("只保留合法 section revision", () => {
    expect(
      normalize_section_revisions({
        items: "2",
        quality: 3,
        task: 4,
        prompts: Number.NaN,
      }),
    ).toEqual({
      items: 2,
      quality: 3,
    });
    expect(normalize_section_revisions({ task: 1 })).toBeUndefined();
  });
});
