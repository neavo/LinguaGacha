import { describe, expect, it } from "vitest";

import { should_skip_by_rule_prefilter } from "./rule-prefilter";

describe("rule-prefilter", () => {
  it("空字符串不过滤，空白行会过滤", () => {
    expect(should_skip_by_rule_prefilter("")).toBe(false);
    expect(should_skip_by_rule_prefilter("   ")).toBe(true);
    expect(should_skip_by_rule_prefilter("  \n  \n  ")).toBe(true);
  });

  it("仅含数字或标点的文本会过滤，普通文本不过滤", () => {
    expect(should_skip_by_rule_prefilter("12345")).toBe(true);
    expect(should_skip_by_rule_prefilter("...!!!")).toBe(true);
    expect(should_skip_by_rule_prefilter("123, 456.")).toBe(true);
    expect(should_skip_by_rule_prefilter("♥￥×÷")).toBe(true);
    expect(should_skip_by_rule_prefilter("Hello World")).toBe(false);
    expect(should_skip_by_rule_prefilter("你好世界")).toBe(false);
  });

  it("仅含非独立语言字符的文本会过滤，真实正文不会被标点拖下水", () => {
    expect(should_skip_by_rule_prefilter("ーーー")).toBe(true);
    expect(should_skip_by_rule_prefilter("・･ー")).toBe(true);
    expect(should_skip_by_rule_prefilter("゙゚ﾞﾟ")).toBe(true);
    expect(should_skip_by_rule_prefilter("カーテン")).toBe(false);
    expect(should_skip_by_rule_prefilter("你好！！")).toBe(false);
    expect(should_skip_by_rule_prefilter("hello!")).toBe(false);
  });

  it("按规则前缀、后缀和正则判断跳过", () => {
    expect(should_skip_by_rule_prefilter("mapdata/title.png")).toBe(true);
    expect(should_skip_by_rule_prefilter("voice.ogg")).toBe(true);
    expect(should_skip_by_rule_prefilter("EV001")).toBe(true);
    expect(should_skip_by_rule_prefilter("DejaVu Sans")).toBe(true);
    expect(should_skip_by_rule_prefilter("Opendyslexic")).toBe(true);
    expect(should_skip_by_rule_prefilter("{#file_time}2024-01-01")).toBe(true);
  });

  it.each([
    "MapData/map001",
    "SE/sound_effect",
    "BGS001",
    "0=some_value",
    "BGM/battle_theme",
    "FIcon/icon01",
  ])("前缀规则忽略大小写和首尾空白：%s", (src) => {
    expect(should_skip_by_rule_prefilter(`  ${src.toUpperCase()}  `)).toBe(true);
  });

  it.each([
    "music.mp3",
    "sound.wav",
    "track.ogg",
    "track.mid",
    "image.png",
    "photo.jpg",
    "pic.jpeg",
    "anim.gif",
    "texture.psd",
    "icon.webp",
    "photo.heif",
    "photo.heic",
    "video.avi",
    "clip.mp4",
    "movie.webm",
    "note.txt",
    "archive.7z",
    "archive.gz",
    "archive.rar",
    "archive.zip",
    "data.json",
    "save.sav",
    "file.mps",
    "font.ttf",
    "font.otf",
    "font.woff",
  ])("后缀规则忽略首尾空白：%s", (src) => {
    expect(should_skip_by_rule_prefilter(`  ${src}  `)).toBe(true);
  });

  it.each(["EV001", "ev123", "EV99999"])("EV 编号整体匹配才过滤：%s", (src) => {
    expect(should_skip_by_rule_prefilter(src)).toBe(true);
  });

  it("多行文本只在每一行都命中过滤规则时跳过", () => {
    expect(should_skip_by_rule_prefilter("123!!!\nvoice.ogg")).toBe(true);
    expect(should_skip_by_rule_prefilter("123!!!\nplain text")).toBe(false);
    expect(should_skip_by_rule_prefilter("Hello\nWorld")).toBe(false);
  });

  it("普通句子里出现规则片段时不会误过滤", () => {
    expect(should_skip_by_rule_prefilter("EV001abc")).toBe(false);
    expect(should_skip_by_rule_prefilter("file.mp3 is good")).toBe(false);
    expect(should_skip_by_rule_prefilter("go to MapData/map")).toBe(false);
  });
});
