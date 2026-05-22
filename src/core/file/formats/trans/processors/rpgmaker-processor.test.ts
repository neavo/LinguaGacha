import { describe, expect, it } from "vitest";

import { RPGMakerTransProcessor } from "./rpgmaker-processor";

describe("RPGMakerTransProcessor", () => {
  it("按 RPGMaker 地址黑名单生成状态并为自动过滤项补 gold", () => {
    const processor = new RPGMakerTransProcessor({});

    expect(
      processor.check("data/Actors.json", ["ステラ", ""], [], ["Actors/1/nickname"]),
    ).toMatchObject({
      src: "ステラ",
      status: "NONE",
      tag: [],
    });
    expect(
      processor.check("data/Actors.json", ["ActorName", ""], [], ["MapInfos/1/name"]),
    ).toMatchObject({
      src: "ActorName",
      status: "EXCLUDED",
      tag: ["gold"],
    });
    expect(processor.check("data/Actors.json", ["Done", "已完成"], [], [])).toMatchObject({
      src: "Done",
      status: "PROCESSED",
      tag: [],
    });
  });

  it("MZ 插件命令只有 text 字段保留翻译，其它自动过滤字段带 gold", () => {
    const processor = new RPGMakerTransProcessor({});

    expect(
      processor.check(
        "data/CommonEvents.json",
        ["ShowMessage", ""],
        [],
        ["CommonEvents/1/list/0/MZ Plugin Command/command"],
      ),
    ).toMatchObject({
      src: "ShowMessage",
      status: "EXCLUDED",
      tag: ["gold"],
    });
    expect(
      processor.check(
        "data/CommonEvents.json",
        ["正文", ""],
        [],
        ["CommonEvents/1/list/0/MZ Plugin Command/text"],
      ),
    ).toMatchObject({
      src: "正文",
      status: "NONE",
      tag: [],
    });
  });

  it("按资源扩展名、路径缓存、颜色标签和地址黑名单过滤分区", () => {
    const processor = new RPGMakerTransProcessor({});

    expect(processor.filter("sound.mp3", "Map001.json", [], ["ctx1", "ctx2"])).toEqual([
      true,
      true,
    ]);
    expect(processor.filter("hello", "plugin.js", [], ["ctx1"])).toEqual([true]);
    expect(processor.filter("hello", "Map001.json", ["blue"], ["any"])).toEqual([true]);
    expect(processor.filter("hello", "Map001.json", [], ["MapInfos/1/name"])).toEqual([true]);
    expect(processor.filter("hello", "Map001.json", [], [])).toEqual([false]);
  });
});
