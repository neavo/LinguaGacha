import { describe, expect, it } from "vitest";

import { should_skip_by_rule_prefilter } from "./rule-prefilter";

describe("rule-prefilter", () => {
  it("空字符串和仅空白文本会过滤", () => {
    expect(should_skip_by_rule_prefilter("")).toBe(true);
    expect(should_skip_by_rule_prefilter("\t\n　")).toBe(true);
  });

  it("没有正文字符的数字标点会过滤，正文不过滤", () => {
    expect(should_skip_by_rule_prefilter("123, 456.")).toBe(true);
    expect(should_skip_by_rule_prefilter("你好！！")).toBe(false);
  });

  it("非独立语言字符会过滤，真实正文不过滤", () => {
    expect(should_skip_by_rule_prefilter("・･ー")).toBe(true);
    expect(should_skip_by_rule_prefilter("カーテン")).toBe(false);
  });

  it("脚本元数据会过滤", () => {
    expect(should_skip_by_rule_prefilter("DejaVu Sans")).toBe(true);
    expect(should_skip_by_rule_prefilter("Opendyslexic")).toBe(true);
    expect(should_skip_by_rule_prefilter("{#file_time}2024-01-01")).toBe(true);
  });

  it("资源规则忽略大小写和首尾空白", () => {
    expect(should_skip_by_rule_prefilter("  MAPDATA/MAP001  ")).toBe(true);
    expect(should_skip_by_rule_prefilter("  MUSIC.MP3  ")).toBe(true);
  });

  it("完整 URI 和 Base64 data URI 会过滤，混合正文继续翻译", () => {
    expect(should_skip_by_rule_prefilter("https://example.com/guide?id=1")).toBe(true);
    expect(should_skip_by_rule_prefilter("data:image/png;base64,AAAA")).toBe(true);
    expect(should_skip_by_rule_prefilter("请查看 https://example.com/guide")).toBe(false);
  });

  it("EV 编号完整匹配时过滤", () => {
    expect(should_skip_by_rule_prefilter("EV001")).toBe(true);
  });

  it("多行文本只在每一行都命中过滤规则时跳过", () => {
    expect(should_skip_by_rule_prefilter("123!!!\nvoice.ogg")).toBe(true);
    expect(should_skip_by_rule_prefilter("123!!!\nplain text")).toBe(false);
  });

  it("普通句子里出现规则片段时不会误过滤", () => {
    expect(should_skip_by_rule_prefilter("EV001abc")).toBe(false);
    expect(should_skip_by_rule_prefilter("file.mp3 is good")).toBe(false);
    expect(should_skip_by_rule_prefilter("go to MapData/map")).toBe(false);
  });
});
