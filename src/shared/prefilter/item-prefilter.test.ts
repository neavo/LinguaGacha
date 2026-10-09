import { describe, expect, it } from "vitest";
import { read_item_translation_candidates } from "./item-prefilter";

describe("read_item_translation_candidates", () => {
  it("移除姓名中的纯资源引用，保留文字与资源混合的姓名及原始字段边界", () => {
    expect(
      read_item_translation_candidates({ src: "……", name_src: "data:image/png;base64,AAAA" }),
    ).toEqual([]);
    expect(
      read_item_translation_candidates({ src: "EV12", name_src: ["Alice image.png", "附加字段"] }),
    ).toEqual([{ field: "name_src", text: "Alice image.png" }]);
  });

  it("强制翻译绕过内容规则并只读取可见姓名槽位", () => {
    expect(
      read_item_translation_candidates({
        src: "EV12",
        name_src: ["…", "附加字段"],
        skip_internal_filter: true,
      }),
    ).toEqual([
      { field: "src", text: "EV12" },
      { field: "name_src", text: "…" },
    ]);
  });
});

describe("正文候选规则", () => {
  it("空字符串和仅空白文本会过滤", () => {
    expect(has_no_body_candidate("")).toBe(true);
    expect(has_no_body_candidate("\t\n　")).toBe(true);
  });

  it("没有正文字符的数字标点会过滤，正文不过滤", () => {
    expect(has_no_body_candidate("123, 456.")).toBe(true);
    expect(has_no_body_candidate("你好！！")).toBe(false);
  });

  it("非独立语言字符会过滤，真实正文不过滤", () => {
    expect(has_no_body_candidate("・･ー")).toBe(true);
    expect(has_no_body_candidate("カーテン")).toBe(false);
  });

  it("脚本元数据会过滤", () => {
    expect(has_no_body_candidate("DejaVu Sans")).toBe(true);
    expect(has_no_body_candidate("Opendyslexic")).toBe(true);
    expect(has_no_body_candidate("{#file_time}2024-01-01")).toBe(true);
  });

  it("资源规则忽略大小写和首尾空白", () => {
    expect(has_no_body_candidate("  MAPDATA/MAP001  ")).toBe(true);
    expect(has_no_body_candidate("  MUSIC.MP3  ")).toBe(true);
  });

  it("完整 URI 和 Base64 data URI 会过滤，混合正文继续翻译", () => {
    expect(has_no_body_candidate("https://example.com/guide?id=1")).toBe(true);
    expect(has_no_body_candidate("data:image/png;base64,AAAA")).toBe(true);
    expect(has_no_body_candidate("请查看 https://example.com/guide")).toBe(false);
  });

  it("EV 编号完整匹配时过滤", () => {
    expect(has_no_body_candidate("EV001")).toBe(true);
  });

  it("多行文本只在每一行都命中过滤规则时跳过", () => {
    expect(has_no_body_candidate("123!!!\nvoice.ogg")).toBe(true);
    expect(has_no_body_candidate("123!!!\nplain text")).toBe(false);
  });

  it("普通句子里出现规则片段时不会误过滤", () => {
    expect(has_no_body_candidate("EV001abc")).toBe(false);
    expect(has_no_body_candidate("file.mp3 is good")).toBe(false);
    expect(has_no_body_candidate("go to MapData/map")).toBe(false);
  });
});

/** 从条目候选入口观察正文是否被过滤。 */
function has_no_body_candidate(src: string): boolean {
  return read_item_translation_candidates({ src }).length === 0;
}
