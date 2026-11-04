import { describe, expect, it } from "vitest";
import {
  is_agent_file_href,
  resolve_agent_text_format,
  resolve_agent_file_href,
} from "./agent-workspace-file";

describe("Agent 文件链接", () => {
  it("外部文档按 URL 解析相对文件与锚点，工作区文档可引用绝对文件 URL", () => {
    const document = "file:///D:/Output/reports/check.md";
    expect(resolve_agent_file_href("./a%20b.png", document)).toBe(
      "file:///D:/Output/reports/a%20b.png",
    );
    expect(resolve_agent_file_href("../b.md", document)).toBe("file:///D:/Output/b.md");
    expect(resolve_agent_file_href("#sec", document)).toBe(`${document}#sec`);
    expect(resolve_agent_file_href("file:///D:/Output/a b.md", "work/report.md")).toBe(
      "file:///D:/Output/a%20b.md",
    );
  });
  it.each([
    ["work/report.md", true],
    ["file:///D:/Output/setup.exe", true],
    ["FILE://server/share/report.md", true],
    ["https://example.com", false],
    ["//example.com/report.md", false],
    ["#sec", false],
    ["mailto:user@example.com", false],
  ] as const)("文件入口分类 %s", (href, local) => {
    expect(is_agent_file_href(href)).toBe(local);
  });
  it("相对当前文档归一目录，只解码一次并保留标题片段", () => {
    expect(resolve_agent_file_href("../结果%20%23%2523.MD#结论", "work/reports/check.md")).toBe(
      "work/%E7%BB%93%E6%9E%9C%20%23%2523.MD#结论",
    );
    expect(resolve_agent_file_href("#结论", "work/check.md")).toBe("work/check.md#结论");
  });
  it.each([
    ["work/%E6%8A%A5%E5%91%8A.MARKDOWN#结论", "markdown"],
    ["work/report.md", "markdown"],
    ["work/data.JSON?version=1#result", "json"],
    ["work/data.%6asonl#record", "jsonl"],
    ["work/report.pdf", null],
    ["work/data.json/", null],
    ["work/bad%ZZ.json", null],
  ] as const)("识别文本格式 %s", (href, format) => {
    expect(resolve_agent_text_format(href)).toBe(format);
  });
  it.each([
    "../../outside.md",
    "/outside.md",
    "C:/report.md",
    "%2e%2e/%2e%2e/outside.md",
    "%00.md",
    "bad%ZZ.md",
  ])("拒绝越界和损坏路径 %s", (href) => {
    expect(() => resolve_agent_file_href(href, "work/report.md")).toThrow();
  });
});
