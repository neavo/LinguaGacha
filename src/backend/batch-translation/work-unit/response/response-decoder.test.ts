import { describe, expect, it } from "vitest";

import { ResponseDecoder } from "./response-decoder";

describe("响应解码器", () => {
  it("解码单 item 的 SakuraLLM 纯文本响应并保留内部换行", () => {
    expect(new ResponseDecoder().decode_plain_text_item("第一行\n第二行", 3)).toEqual([
      { request_index: 3, text_dst: "第一行\n第二行", actor_dst: null },
    ]);
  });

  it("解码一条包含真实换行的 item JSONL 记录", async () => {
    await expect(
      new ResponseDecoder().decode_translation('{"index":"7","text":"第一行\\n第二行"}', "text"),
    ).resolves.toEqual([{ request_index: 7, text_dst: "第一行\n第二行", actor_dst: null }]);
  });

  it("actor item 使用同一 index/text 骨架并校验 actor", async () => {
    await expect(
      new ResponseDecoder().decode_translation(
        '{"index":2,"actor":null,"text":"正文\\n续行"}',
        "actor_text",
      ),
    ).resolves.toEqual([{ request_index: 2, text_dst: "正文\n续行", actor_dst: null }]);
  });

  it("按序号解码纯文本翻译 JSONLINE", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
{"index":0,"text":"你好"}
{"index":1,"text":"世界"}
`.trim(),
      "text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: null },
      { request_index: 1, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("纯文本模式跳过无效 JSONL 记录并保留有效 item", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"index":0,"text":"你好"}\n{"index":1,"text":2}\n{"index":2,"text":"世界"}',
      "text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: null },
      { request_index: 2, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("空白译文不形成有效翻译记录", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"index":0,"text":""}\n{"index":1,"text":"   "}\n{"index":2,"text":"有效译文"}',
      "text",
    );

    expect(decoded).toEqual([{ request_index: 2, text_dst: "有效译文", actor_dst: null }]);
  });

  it("按 actor/text 模式解码正文和姓名译文", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      `
\`\`\`jsonline
{"index":0,"actor":" 虎铁 ","text":"你好"}
{"index":1,"actor":[" 爱丽丝 ",""],"text":"世界"}
{"index":2,"actor":null,"text":"旁白"}
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
{"index":0,"text":"你好"}
{"index":1,"actor":"虎铁"}
{"index":2,"actor":"虎铁","text":"通过"}
`.trim(),
      "actor_text",
    );

    expect(decoded).toEqual([{ request_index: 2, text_dst: "通过", actor_dst: "虎铁" }]);
  });

  it("actor/text 模式支持多条 JSONL item 响应", async () => {
    const decoded = await new ResponseDecoder().decode_translation(
      '{"index":0,"actor":"虎铁","text":"你好"}\n{"index":1,"actor":null,"text":"旁白"}',
      "actor_text",
    );

    expect(decoded).toEqual([
      { request_index: 0, text_dst: "你好", actor_dst: "虎铁" },
      { request_index: 1, text_dst: "旁白", actor_dst: null },
    ]);
  });

  it("非 JSON 回复返回空结果", async () => {
    const decoder = new ResponseDecoder();

    await expect(decoder.decode_translation("not a json response", "text")).resolves.toEqual([]);
  });
});
