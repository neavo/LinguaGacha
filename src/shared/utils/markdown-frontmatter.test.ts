import { expect, it } from "vitest";
import { read_markdown_frontmatter } from "./markdown-frontmatter";

it("头部保留原文，错误 YAML 默认拒绝，技能可修复散文标量", () => {
  expect(read_markdown_frontmatter("ordinary Markdown")).toBeNull();
  for (const text of ["---\ndescription: [\n---\n", "---\n- item\n---\n", "---\nunclosed"])
    expect(() => read_markdown_frontmatter(text)).toThrow();
  const header =
    "---\r\nname: Sample\r\ndescription: Build for AWS: ECS # keep\r\nmetadata:\r\n  note: |\r\n    keep: this\r\n---\r\n";
  const body = "\n  Body  \n";
  expect(() => read_markdown_frontmatter(header + body)).toThrow();
  const document = read_markdown_frontmatter(header + body, true)!;
  expect(document.header).toBe(header);
  expect(document.body).toBe(body);
  expect(document.yaml.toJS()).toEqual({
    name: "Sample",
    description: "Build for AWS: ECS",
    metadata: { note: "keep: this\n" },
  });
  expect(document.yaml.toString()).toContain("# keep");
});
