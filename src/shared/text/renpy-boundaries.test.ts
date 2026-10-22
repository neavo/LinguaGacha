import { expect, it } from "vitest";
import { scan_renpy_boundaries } from "./renpy-boundaries";

it("完整保护嵌套插值、带引号的下标、格式说明和字符串表标签", () => {
  const text = 'Hello [a[0]] [d["]"]!t:.2f] {#menu} {a=[url]}link{/a} [[ {{';
  const values = ["[a[0]]", '[d["]"]!t:.2f]', "{#menu}", "{a=[url]}", "{/a}", "[[", "{{"];
  expect(scan_renpy_boundaries(text).map((match) => match.value)).toEqual(values);
});
