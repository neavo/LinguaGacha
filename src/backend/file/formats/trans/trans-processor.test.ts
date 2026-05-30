import { describe, expect, it } from "vitest";

import { derive_trans_filter_effect, NoneTransProcessor } from "./trans-processor";

describe("derive_trans_filter_effect", () => {
  it("自动过滤项带 gold，未过滤项移除计算 gold，混合分区允许参数生成", () => {
    expect(
      derive_trans_filter_effect({
        block: [true],
        tag: ["keep"],
      }),
    ).toEqual({
      block: [true],
      tag: ["keep", "gold"],
      status: "EXCLUDED",
      is_mixed_partition: false,
    });

    expect(
      derive_trans_filter_effect({
        block: [false],
        tag: ["gold", "keep"],
      }),
    ).toEqual({
      block: [false],
      tag: ["keep"],
      status: "NONE",
      is_mixed_partition: false,
    });

    expect(
      derive_trans_filter_effect({
        block: [false, true],
        tag: ["keep"],
      }),
    ).toEqual({
      block: [false, true],
      tag: ["keep", "gold"],
      status: "NONE",
      is_mixed_partition: true,
    });
  });

  it("span 参数禁止混合分区写回参数但保留 gold 过滤提示", () => {
    expect(
      derive_trans_filter_effect({
        block: [false, true],
        tag: [],
        parameter: [{ start: 1, end: 2 }],
      }),
    ).toEqual({
      block: [false, true],
      tag: ["gold"],
      status: "NONE",
      is_mixed_partition: false,
    });
  });
});

describe("NoneTransProcessor", () => {
  it("按空源文、aqua 标签、已有译文和缺失译文列生成状态", () => {
    const processor = new NoneTransProcessor({});

    expect(processor.check("file.json", ["", ""], [], ["ctx"])).toMatchObject({
      src: "",
      dst: "",
      tag: [],
      status: "EXCLUDED",
      skip_internal_filter: false,
    });
    expect(processor.check("file.json", ["src", "src"], ["aqua"], ["ctx"])).toMatchObject({
      src: "src",
      dst: "src",
      tag: ["aqua"],
      status: "NONE",
      skip_internal_filter: true,
    });
    expect(processor.check("file.json", ["src", "dst"], [], ["ctx"])).toMatchObject({
      src: "src",
      dst: "dst",
      status: "PROCESSED",
    });
    expect(processor.check("file.json", ["src-only", ""], [], ["ctx"])).toMatchObject({
      src: "src-only",
      dst: "",
      status: "NONE",
    });
  });

  it("默认过滤器按资源扩展名和颜色标签排除文本", () => {
    const processor = new NoneTransProcessor({});

    expect(processor.filter("a.mp3", "file.json", [], ["1", "2"])).toEqual([true, true]);
    expect(processor.filter("hello", "file.json", ["red"], ["1"])).toEqual([true]);
    expect(processor.filter("hello", "file.json", [], ["1", "2"])).toEqual([false, false]);
  });

  it("只为非 span 的混合分区生成 contextStr 和 translation", () => {
    const processor = new NoneTransProcessor({});

    expect(processor.generate_parameter("src", ["a", "b"], [], [false, true])).toEqual([
      { contextStr: "a", translation: "" },
      { contextStr: "b", translation: "src" },
    ]);
    expect(
      processor.generate_parameter("src", ["a", "b"], [{ start: 1, end: 2 }], [false, true]),
    ).toEqual([{ start: 1, end: 2 }]);
    expect(processor.generate_parameter("src", ["a"], [{ keep: "value" }], [true])).toEqual([
      { keep: "value" },
    ]);
  });
});
