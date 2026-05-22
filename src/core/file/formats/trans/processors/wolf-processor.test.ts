import { describe, expect, it } from "vitest";

import { WolfTransProcessor } from "./wolf-processor";

describe("WolfTransProcessor", () => {
  it("根据数据库非零 stringArgs 收集屏蔽文本", () => {
    const processor = new WolfTransProcessor({
      files: {
        "a.json": {
          data: [["block_me"], ["keep"]],
          context: [
            ["common/110.json/commands/29/Database/stringArgs/1"],
            ["common/110.json/commands/29/Database/stringArgs/0"],
          ],
        },
      },
    });
    processor.pre_process();

    expect(
      processor.filter("block_me", "a.json", [], ["DataBase.json/types/1/data/2/data/3/value"]),
    ).toEqual([true]);
    expect(
      processor.filter("keep", "a.json", [], ["DataBase.json/types/1/data/2/data/3/value"]),
    ).toEqual([false]);
  });

  it("应用白名单、黑名单、common 规则和空 context 颜色规则", () => {
    const processor = new WolfTransProcessor({});

    expect(
      processor.filter(
        "hello",
        "path",
        [],
        [
          "common/1.json/Message/stringArgs/0",
          "common/1.json/name",
          "common/1.json/anything",
          "map/001.json/events/3/message",
        ],
      ),
    ).toEqual([false, true, true, false]);
    expect(processor.filter("sound.mp3", "path", [], ["a", "b", "c"])).toEqual([true, true, true]);
    expect(processor.filter("hello", "path", ["red"], ["x/y"])).toEqual([true]);
    expect(processor.filter("hello", "path", [], [])).toEqual([false]);
  });
});
