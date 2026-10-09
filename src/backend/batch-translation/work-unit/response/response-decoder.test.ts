import { describe, expect, it } from "vitest";

import { decode_sakura, decode_translation, split_translation_response } from "./response-decoder";

describe("响应解码器", () => {
  const sakura_items = [
    { request_id: 3, item_index: 1, text_src: "甲\r\n\r\n乙\r\n", actor_src: null },
    { request_id: 8, item_index: 2, text_src: "丙", actor_src: null },
  ];

  it("SakuraLLM 单条接收非空完整响应并允许换行变化", () => {
    expect(decode_sakura("第一行\n第二行", sakura_items.slice(0, 1))).toEqual([
      { request_id: 3, text_dst: "第一行\n第二行", actor_dst: null },
    ]);
    expect(decode_sakura(" \n ", sakura_items.slice(0, 1))).toEqual([]);
  });

  it("SakuraLLM 多条对应保留内部空行和条目末尾空行", () => {
    expect(decode_sakura("一\r\n\r\n二\r\n\r\n三", sakura_items)).toEqual([
      { request_id: 3, text_dst: "一\n\n二\n", actor_dst: null },
      { request_id: 8, text_dst: "三", actor_dst: null },
    ]);
  });

  it.each(["一\n二", "一\n\n二\n\n三\n"])(
    "SakuraLLM 响应行数无法对应时不生成译文：%s",
    (response) => {
      expect(decode_sakura(response, sakura_items)).toEqual([]);
    },
  );

  it.each([
    '{"id":"7","text":"第一行\\n第二行"}',
    '{\n  "id": "7",\n  "text": "第一行\\n第二行"\n}',
  ])("解码单行或多行 JSON 对象并恢复译文换行 %j", async (response) => {
    await expect(decode_translation(response, "text")).resolves.toEqual([
      { request_id: 7, text_dst: "第一行\n第二行", actor_dst: null },
    ]);
  });

  it("actor item 使用同一 id/text 骨架并校验 actor", async () => {
    await expect(
      decode_translation('{"id":2,"actor":null,"text":"正文\\n续行"}', "actor_text"),
    ).resolves.toEqual([{ request_id: 2, text_dst: "正文\n续行", actor_dst: null }]);
  });

  it("按请求 ID 解码纯文本翻译 JSONLINE", async () => {
    const decoded = await decode_translation(
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
    const decoded = await decode_translation(
      '{"id":0,"text":"你好"}\n{"id":1,"text":2}\n{"id":2,"text":"世界"}',
      "text",
    );

    expect(decoded).toEqual([
      { request_id: 0, text_dst: "你好", actor_dst: null },
      { request_id: 2, text_dst: "世界", actor_dst: null },
    ]);
  });

  it("结构解码保留空白正文，由请求对应的校验判断是否需要正文", async () => {
    const decoded = await decode_translation(
      '{"id":0,"text":""}\n{"id":1,"text":"   "}\n{"id":2,"text":"有效译文"}',
      "text",
    );

    expect(decoded).toEqual([
      { request_id: 0, text_dst: "", actor_dst: null },
      { request_id: 1, text_dst: "   ", actor_dst: null },
      { request_id: 2, text_dst: "有效译文", actor_dst: null },
    ]);
  });

  it("按 actor/text 模式解码正文和姓名译文", async () => {
    const decoded = await decode_translation(
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
    const decoded = await decode_translation(
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
    const result = await decode_translation(JSON.stringify({ id, text: "译文" }), "text");
    expect(result).toEqual(
      expected === null ? [] : [{ request_id: expected, text_dst: "译文", actor_dst: null }],
    );
  });

  it("仅旧 index 字段的记录不参与请求 ID 匹配", async () => {
    await expect(
      decode_translation('{"index":0,"text":"旧字段"}\n{"id":1,"text":"译文"}', "text"),
    ).resolves.toEqual([{ request_id: 1, text_dst: "译文", actor_dst: null }]);
  });

  it("非 JSON 回复返回空结果", async () => {
    await expect(decode_translation("not a json response", "text")).resolves.toEqual([]);
  });
});

describe("翻译响应分离", () => {
  it("合并连续的前置分析块，保留正文中的同名标签", () => {
    const translation_text = '\n```jsonline\n{"id":0,"text":"<why>正文</why>"}\n```';
    expect(
      split_translation_response(
        ` \n<WHY> 语境 </WHY>\n<why> </why>\n<why>决策</why>${translation_text}`,
      ),
    ).toEqual({ rule_analysis_text: "语境\n决策", translation_text });
  });

  it.each([
    "",
    " \n",
    ' \n{"id":0,"text":"<why>正文</why>"}\n',
    '```jsonline\n{"id":0,"text":"译文"}\n```\n<why>尾部内容</why>',
  ])("没有前置分析时原样保留正文 %j", (translation_text) => {
    expect(split_translation_response(translation_text)).toEqual({
      rule_analysis_text: "",
      translation_text,
    });
  });

  it.each(["", "<why>语境</why>\n"])("未闭合分析中的候选 JSON 留在诊断中 %j", (prefix) => {
    const candidate = '{"id":0,"text":"候选译文"}';
    expect(split_translation_response(`${prefix}<why>决策\n${candidate}`)).toEqual({
      rule_analysis_text: `${prefix === "" ? "" : "语境\n"}决策\n${candidate}`,
      translation_text: "",
    });
  });
});
