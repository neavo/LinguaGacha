import { describe, expect, it } from "vitest";

import { split_translation_response } from "./split-translation-response";

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
