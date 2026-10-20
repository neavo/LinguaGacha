import { expect, it } from "vitest";
import { read_po, patch_po } from "./po";

it("PO 多行 msgstr 按区间写回，保留注释、context、msgid_plural 与其它槽位", () => {
  const source =
    '# comment\r\nmsgctxt "fruit"\r\nmsgid "apple"\r\nmsgid_plural "apples"\r\nmsgstr[0] "one "\r\n"apple"\r\nmsgstr[1] "many apples"\r\n';
  const field = read_po(source).find((field) => field.kind === "msgstr")!;
  expect(field.text).toBe("one apple");
  const output = patch_po(
    source,
    new Map([[field.start, { end: field.end, original: field.text, text: "一个苹果" }]]),
  );
  expect(output.startsWith(source.slice(0, field.start))).toBe(true);
  expect(output.endsWith(source.slice(field.end))).toBe(true);
  expect(
    read_po(output)
      .filter((field) => field.kind === "msgstr")
      .map((field) => field.text),
  ).toEqual(["一个苹果", "many apples"]);
  for (const change of [
    { end: field.end, original: "stale", text: "译文" },
    { end: field.end + 1, original: field.text, text: "译文" },
  ])
    expect(() => patch_po(source, new Map([[field.start, change]]))).toThrow();
});
