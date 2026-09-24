import { describe, expect, it } from "vitest";
import { format_skill_editor_document, read_skill_editor_document } from "./skill-editor-document";

describe("技能编辑文档", () => {
  it.each(["", "\n\n  body\n\n", "---\nname: body text\n"])(
    "字段与正文往返保留可见内容：%j",
    (body) => {
      const document = { name: "sample", description: 'A: "quote" # `tag`', body };
      const text = format_skill_editor_document(document);
      expect(read_skill_editor_document(text)).toEqual(document);
    },
  );
  it("空字段仍有可编辑位置，换行格式与 CodeMirror 的逻辑行一致", () => {
    const text = format_skill_editor_document({ name: "", description: "", body: "\r\n body\r\n" });
    expect(read_skill_editor_document(text)).toEqual({
      name: "",
      description: "",
      body: "\n body\n",
    });
  });
});
