import { describe, expect, it } from "vitest";

import { ResponseDecoder } from "./response-decoder";

describe("响应解码器", () => {
  it("逐行解码翻译和术语条目", async () => {
    const decoded = await new ResponseDecoder().decode(
      `
{"0":"你好"}
{"src":"Alice","dst":"爱丽丝","type":"女性人名"}
{"invalid":1}
`.trim(),
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

  it("跳过非字符串翻译值并保留后续翻译", async () => {
    const decoded = await new ResponseDecoder().decode('{"0":100}\n{"1":"ok"}');

    expect(decoded.translations).toEqual(["ok"]);
    expect(decoded.glossary_entries).toEqual([]);
  });

  it("跳过空行和无效术语形状", async () => {
    const decoded = await new ResponseDecoder().decode(
      '\n  \n{"src":"Alice","dst":"爱丽丝","role":"hero"}\n{"a":"A","b":"B"}\n{"0":"你好"}',
    );

    expect(decoded.translations).toEqual(["你好"]);
    expect(decoded.glossary_entries).toEqual([]);
  });

  it("解码分析链路的 type 术语字段", async () => {
    const decoded = await new ResponseDecoder().decode(
      `
{"src":"魔导具","dst":"魔导器","type":"特殊物品"}
{"0":"忽略这条翻译"}
`.trim(),
    );

    expect(decoded.translations).toEqual(["忽略这条翻译"]);
    expect(decoded.glossary_entries).toEqual([
      {
        src: "魔导具",
        dst: "魔导器",
        info: "特殊物品",
      },
    ]);
  });

  it("宽容跳过 jsonline 代码块围栏并解码其中术语", async () => {
    const decoded = await new ResponseDecoder().decode(
      `
\`\`\`jsonline
{"src":"HP","dst":"生命值","type":"属性"}
\`\`\`
`.trim(),
    );

    expect(decoded.glossary_entries).toEqual([
      {
        src: "HP",
        dst: "生命值",
        info: "属性",
      },
    ]);
  });

  it("旧 gender 字段不再视为术语条目并按整块 JSON 回退为翻译", async () => {
    const decoded = await new ResponseDecoder().decode(
      '{"src":"Alice","dst":"爱丽丝","gender":"female"}',
    );

    expect(decoded.translations).toEqual(["Alice", "爱丽丝", "female"]);
    expect(decoded.glossary_entries).toEqual([]);
  });

  it("行式解析没有翻译时回退整块 JSON 对象", async () => {
    const decoded = await new ResponseDecoder().decode('{"a":"A","b":2,"c":"C"}');

    expect(decoded.translations).toEqual(["A", "C"]);
    expect(decoded.glossary_entries).toEqual([]);
  });

  it("非 JSON 回复返回空结果", async () => {
    const decoded = await new ResponseDecoder().decode("not a json response");

    expect(decoded.translations).toEqual([]);
    expect(decoded.glossary_entries).toEqual([]);
  });
});
