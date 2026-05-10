import { describe, expect, it } from "vitest";

import { ResponseDecoder } from "./response-decoder";

describe("ResponseDecoder", () => {
  it("解码 JSONLINE 翻译和术语候选", async () => {
    const decoded = await new ResponseDecoder().decode(
      '{"0":"你好"}\n{"src":"Alice","dst":"爱丽丝","type":"女性人名"}',
    );

    expect(decoded.translations).toEqual(["你好"]);
    expect(decoded.glossary_entries).toEqual([
      {
        src: "Alice",
        dst: "爱丽丝",
        info: "女性人名",
      },
    ]);
  });

  it("行式解析失败时回退整块 JSON 对象", async () => {
    const decoded = await new ResponseDecoder().decode('{"0":"你好","1":"世界"}');

    expect(decoded.translations).toEqual(["你好", "世界"]);
  });
});
