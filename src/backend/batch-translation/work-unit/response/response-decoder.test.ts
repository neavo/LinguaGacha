import { describe, expect, it } from "vitest";

import { ResponseDecoder } from "./response-decoder";

describe("响应解码器", () => {
  it("解码单 item 的 SakuraLLM 纯文本响应并保留内部换行", () => {
    expect(new ResponseDecoder().decode_plain_text_item("第一行\n第二行", 3)).toEqual([
      { request_id: 3, text_dst: "第一行\n第二行", actor_dst: null },
    ]);
  });

  it("解码一条包含真实换行的 item JSONL 记录", async () => {
    await expect(
      new ResponseDecoder().decode_translation('{"id":"7","text":"第一行\\n第二行"}', "text"),
    ).resolves.toEqual([{ request_id: 7, text_dst: "第一行\n第二行", actor_dst: null }]);
  });

  it("actor item 使用同一 id/text 骨架并校验 actor", async () => {
    await expect(
      new ResponseDecoder().decode_translation(
        '{"id":2,"actor":null,"text":"正文\\n续行"}',
        "actor_text",
      ),
    ).resolves.toEqual([{ request_id: 2, text_dst: "正文\n续行", actor_dst: null }]);
  });

  it("按请求 ID 解码纯文本翻译 JSONLINE", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
{"id":0,"text":"你好"}
{"id":1,"text":"世界"}
`.trim(),
      "text",
    );

    expect(decoded).toEqual([
      { request_id: 0, text_dst: "你好", actor_dst: null },
      { request_id: 1, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("纯文本模式跳过无效 JSONL 记录并保留有效 item", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"id":0,"text":"你好"}\n{"id":1,"text":2}\n{"id":2,"text":"世界"}',
      "text",
    );

    expect(decoded).toEqual([
      { request_id: 0, text_dst: "你好", actor_dst: null },
      { request_id: 2, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("空白译文不形成有效翻译记录", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"id":0,"text":""}\n{"id":1,"text":"   "}\n{"id":2,"text":"有效译文"}',
      "text",
    );

    expect(decoded).toEqual([{ request_id: 2, text_dst: "有效译文", actor_dst: null }]);
  });

  it("按 actor/text 模式解码正文和姓名译文", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
\`\`\`jsonline
{"id":0,"actor":" 虎铁 ","text":"你好"}
{"id":1,"actor":[" 爱丽丝 ",""],"text":"世界"}
{"id":2,"actor":null,"text":"旁白"}
\`\`\`
`.trim(),
      "actor_text",
    );

    expect(decoded).toEqual([
      { request_id: 0, text_dst: "你好", actor_dst: "虎铁" },
      { request_id: 2, text_dst: "旁白", actor_dst: null },
    ]);
  });

  it("actor/text 模式拒绝字符串值和缺少字段的对象", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
{"id":0,"text":"你好"}
{"id":1,"actor":"虎铁"}
{"id":2,"actor":"虎铁","text":"通过"}
`.trim(),
      "actor_text",
    );

    expect(decoded).toEqual([{ request_id: 2, text_dst: "通过", actor_dst: "虎铁" }]);
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ["0", 0],
    [-1, null],
    [1.5, null],
    [Number.MAX_SAFE_INTEGER + 1, null],
    ["9007199254740992", null],
    ["1.5", null],
  ])("请求 ID %j 按现有整数边界读取", async (id, expected) => {
    const result = await new ResponseDecoder().decode_translation(
      JSON.stringify({ id, text: "译文" }),
      "text",
    );
    expect(result).toEqual(
      expected === null ? [] : [{ request_id: expected, text_dst: "译文", actor_dst: null }],
    );
  });

  it("仅旧 index 字段的记录不参与请求 ID 匹配", async () => {
    await expect(
      new ResponseDecoder().decode_translation(
        '{"index":0,"text":"旧字段"}\n{"id":1,"text":"译文"}',
        "text",
      ),
    ).resolves.toEqual([{ request_id: 1, text_dst: "译文", actor_dst: null }]);
  });

  it("非 JSON 回复返回空结果", async () => {
    const decoder = new ResponseDecoder();

    await expect(decoder.decode_translation("not a json response", "text")).resolves.toEqual([]);
  });
});
