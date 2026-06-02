import { describe, expect, it } from "vitest";

import { ResponseDecoder } from "./response-decoder";

describe("响应解码器", () => {
  it("按序号解码纯文本翻译 JSONLINE", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
{"0":"你好"}
{"1":"世界"}
`.trim(),
      "text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: null },
      { request_index: 1, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("纯文本模式在行式解析失败时回退整块 JSON 对象", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"0":"你好","1":2,"2":"世界"}',
      "text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: null },
      { request_index: 2, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("按 actor/text 模式解码正文和姓名译文", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
\`\`\`jsonline
{"0":{"actor":" 虎铁 ","text":"你好"}}
{"1":{"actor":[" 爱丽丝 ",""],"text":"世界"}}
{"2":{"actor":null,"text":"旁白"}}
\`\`\`
`.trim(),
      "actor_text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: "虎铁" },
      { request_index: 2, text_dst: "旁白", actor_dst: null },
    ]);
  });

  it("actor/text 模式拒绝字符串值和缺少字段的对象", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
{"0":"你好"}
{"1":{"actor":"虎铁"}}
{"2":{"actor":"虎铁","text":"通过"}}
`.trim(),
      "actor_text",
    );

    expect(decoded).toEqual([{ request_index: 2, text_dst: "通过", actor_dst: "虎铁" }]);
  });

  it("actor/text 模式支持整块 JSON 对象响应", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"0":{"actor":"虎铁","text":"你好"},"1":{"actor":null,"text":"旁白"}}',
      "actor_text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: "虎铁" },
      { request_index: 1, text_dst: "旁白", actor_dst: null },
    ]);
  });

  it("解码分析链路的 type 术语字段并跳过翻译行", async () => {
    const decoded = await new ResponseDecoder().decode_glossary_entries(
      `
{"src":"魔导具","dst":"魔导器","type":"特殊物品"}
{"0":"忽略这条翻译"}
`.trim(),
    );

    expect(decoded).toEqual([
      {
        src: "魔导具",
        dst: "魔导器",
        info: "特殊物品",
      },
    ]);
  });

  it("宽容跳过 jsonline 代码块围栏并解码其中术语", async () => {
    const decoded = await new ResponseDecoder().decode_glossary_entries(
      `
\`\`\`jsonline
{"src":"HP","dst":"生命值","type":"属性"}
\`\`\`
`.trim(),
    );

    expect(decoded).toEqual([
      {
        src: "HP",
        dst: "生命值",
        info: "属性",
      },
    ]);
  });

  it("非 JSON 回复返回空结果", async () => {
    const decoder = new ResponseDecoder();

    await expect(decoder.decode_translation("not a json response", "text")).resolves.toEqual([]);
    await expect(decoder.decode_glossary_entries("not a json response")).resolves.toEqual([]);
  });
});
