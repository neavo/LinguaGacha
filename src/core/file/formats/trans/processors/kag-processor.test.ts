import { describe, expect, it } from "vitest";

import { KagTransProcessor } from "./kag-processor";

describe("KagTransProcessor", () => {
  it("声明 KAG 文本类型并复用默认过滤规则", () => {
    const processor = new KagTransProcessor({});

    expect(processor.text_type).toBe("KAG");
    expect(processor.filter("hello", "script.ks", [], ["ctx"])).toEqual([false]);
    expect(processor.filter("voice.ogg", "script.ks", [], ["ctx"])).toEqual([true]);
  });
});
