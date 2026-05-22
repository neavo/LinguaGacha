import { describe, expect, it } from "vitest";

import { RenPyTransProcessor } from "./renpy-processor";

describe("RenPyTransProcessor", () => {
  it("声明 RENPY 文本类型并复用默认过滤规则", () => {
    const processor = new RenPyTransProcessor({});

    expect(processor.text_type).toBe("RENPY");
    expect(processor.filter("dialogue", "script.rpy", [], ["ctx"])).toEqual([false]);
    expect(processor.filter("image.png", "script.rpy", [], ["ctx"])).toEqual([true]);
  });
});
