import { expect, it } from "vitest";
import { read_epub_entry_text } from "./epub-fixture";
import { write_zip, zip_text } from "./zip-fixture";

it.each([
  { content: "正文", expected: "正文" },
  { content: new TextEncoder().encode("正文"), expected: "正文" },
  { content: "", expected: "" },
  { content: new Uint8Array(), expected: "" },
])("ZIP 成员读取保留文本和空内容：$content", ({ content, expected }) => {
  expect(zip_text(new Map([["chapter.txt", content]]), "chapter.txt")).toBe(expected);
});

it("ZIP 缺失成员报错并包含成员路径", () => {
  expect(() => zip_text(new Map(), "missing.txt")).toThrow("ZIP member not found: missing.txt");
});

it("EPUB 读取默认和指定成员，空成员成功、缺失成员失败", async () => {
  const archive = await write_zip(
    new Map<string, string | Uint8Array>([
      ["OPS/chapter.xhtml", "默认正文"],
      ["OPS/other.xhtml", new TextEncoder().encode("指定正文")],
      ["OPS/empty.xhtml", ""],
      ["OPS/empty-bytes.xhtml", new Uint8Array()],
    ]),
  );
  await expect(read_epub_entry_text(archive)).resolves.toBe("默认正文");
  await expect(read_epub_entry_text(archive, "OPS/other.xhtml")).resolves.toBe("指定正文");
  await expect(read_epub_entry_text(archive, "OPS/empty.xhtml")).resolves.toBe("");
  await expect(read_epub_entry_text(archive, "OPS/empty-bytes.xhtml")).resolves.toBe("");
  await expect(read_epub_entry_text(archive, "OPS/missing.xhtml")).rejects.toThrow(
    "ZIP member not found: OPS/missing.xhtml",
  );
});
