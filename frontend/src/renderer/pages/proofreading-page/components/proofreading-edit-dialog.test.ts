import { describe, expect, it } from "vitest";

import { find_text_match_ranges } from "./proofreading-edit-dialog";

describe("find_text_match_ranges", () => {
  it("使用 CodeMirror 归一后的换行坐标匹配 Windows 换行文本", () => {
    const text = "そこで注目を浴びているのは、\r\n星継\r\n銀音\r\n。";

    expect(find_text_match_ranges(text, "星継")).toEqual([{ start: 15, end: 17 }]);
    expect(find_text_match_ranges(text, "銀音")).toEqual([{ start: 18, end: 20 }]);
  });

  it("同步归一多行术语片段，避免片段自身含 CRLF 时偏移", () => {
    const text = "alpha\r\nbeta\r\ngamma";

    expect(find_text_match_ranges(text, "beta\r\ngamma")).toEqual([{ start: 6, end: 16 }]);
  });
});
