import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { read_agent_skill_document, write_agent_skill_document } from "./agent-skill-document";

describe("技能主文件编辑", () => {
  const original =
    '---\r\nname: sample\r\ndescription: "Original"\r\n# 留给其它消费者的字段\r\ndisable-model-invocation: true\r\nextra: [one, two]\r\n---\r\n\n  Body  \n';
  it("字段处理 YAML 特殊字符并保留额外字段与注释", () => {
    const document = { name: "changed", description: 'A: "quote" # tag', body: "body\n" };
    const result = write_agent_skill_document(original, document);
    expect(read_agent_skill_document(result)).toEqual(document);
    expect(result).toContain("disable-model-invocation: true");
    expect(parse(result.split("---")[1]).extra).toEqual(["one", "two"]);
    expect(result).toContain("# 留给其它消费者的字段");
  });
  it.each(["", "\n \t\r\n\n"])("正文空白随读取和写入保留：%j", (separator) => {
    const header = "---\r\nname: sample\r\ndescription: description\r\n---\r\n";
    const text = header + separator + "    indented\n\nparagraph\n\n";
    const value = read_agent_skill_document(text);
    expect(value.body).toBe(separator + "    indented\n\nparagraph\n\n");
    expect(write_agent_skill_document(text, value)).toBe(text);
    const body = separator + "  changed\n\n";
    expect(write_agent_skill_document(text, { ...value, body })).toBe(header + body);
    expect(
      read_agent_skill_document(
        write_agent_skill_document(text, { ...value, description: "changed" }),
      ).body,
    ).toBe(value.body);
  });
  it("空正文不追加空行，新增正文只补齐结束标记所在行", () => {
    const text = "---\nname: sample\ndescription: description\n---";
    const value = read_agent_skill_document(text);
    expect(value.body).toBe("");
    expect(write_agent_skill_document(text, value)).toBe(text);
    expect(write_agent_skill_document(text, { ...value, body: "body" })).toBe(text + "\nbody");
  });
  it("损坏的元数据无法进入编辑视图", () => {
    expect(() => read_agent_skill_document("---\nname: [broken\n---\ntext")).toThrow();
  });
  it("名称必须由元数据声明", () => {
    expect(() => read_agent_skill_document("---\ndescription: description\n---\nbody")).toThrow();
  });
});
