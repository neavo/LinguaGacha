import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { read_agent_skill_document, write_agent_skill_document } from "./agent-skill-document";

describe("技能主文件表单", () => {
  const original =
    '---\r\nname: sample\r\ndescription: "Original"\r\n# 留给其它消费者的字段\r\ndisable-model-invocation: true\r\nextra: [one, two]\r\n---\r\n\n  Body  \n';
  it("分隔空行不进入正文，保存保留头部、首行缩进和末尾空行", () => {
    const value = read_agent_skill_document(original);
    expect(value).toEqual({ name: "sample", description: "Original", body: "  Body  \n" });
    expect(
      write_agent_skill_document(original, { ...value, body: "\n \t\n  new\n\nnext\n\n" }),
    ).toBe(original.replace("\n  Body  \n", "\r\n  new\n\nnext\n\n"));
  });
  it("表单处理 YAML 特殊字符并保留额外字段与注释", () => {
    const document = { name: "changed", description: 'A: "quote" # tag', body: "body\n" };
    const result = write_agent_skill_document(original, document);
    expect(read_agent_skill_document(result)).toEqual(document);
    expect(result).toContain("---\n\nbody\n");
    expect(result).toContain("disable-model-invocation: true");
    expect(parse(result.split("---")[1]).extra).toEqual(["one", "two"]);
    expect(result).toContain("# 留给其它消费者的字段");
  });
  it.each(["", "\n", "\n \t\r\n\n"])("不同数量的分隔空行统一写回：%j", (separator) => {
    const header = "---\nname: sample\ndescription: description\n---\n";
    const text = header + separator + "    indented\n\nparagraph\n\n";
    const value = read_agent_skill_document(text);
    expect(value.body).toBe("    indented\n\nparagraph\n\n");
    const saved = write_agent_skill_document(text, value);
    expect(saved).toBe(header + "\n" + value.body);
    expect(write_agent_skill_document(saved, read_agent_skill_document(saved))).toBe(saved);
  });
  it("空正文及结束标记后没有换行时仍生成固定分隔", () => {
    const text = "---\nname: sample\ndescription: description\n---";
    const value = read_agent_skill_document(text);
    expect(value.body).toBe("");
    expect(write_agent_skill_document(text, value)).toBe(text + "\n\n");
  });
  it("损坏的元数据无法进入表单", () => {
    expect(() => read_agent_skill_document("---\nname: [broken\n---\ntext")).toThrow();
  });
  it("名称省略时与技能加载器一样使用目录名", () => {
    expect(read_agent_skill_document("---\ndescription: description\n---\nbody", "sample")).toEqual(
      { name: "sample", description: "description", body: "body" },
    );
  });
});
