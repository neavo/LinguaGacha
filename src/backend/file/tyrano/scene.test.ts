import { expect, it } from "vitest";
import { decode_static_text, encode_static_text, scan_scene, type SceneSyntax } from "./scene";

const LEGACY: SceneSyntax = { parser: "legacy", keep_space: "" };
const MODERN: SceneSyntax = { parser: "modern", keep_space: "" };

/** 只比较引擎可见的节点种类、名称与取值。 */
function view(text: string, syntax: SceneSyntax): unknown[] {
  return scan_scene(text, syntax).nodes.map((node) =>
    node.kind === "text"
      ? [node.mode, node.value]
      : node.kind === "tag"
        ? [node.name, Object.fromEntries(node.pm)]
        : node.kind === "name"
          ? ["#", node.name, node.face]
          : ["*", node.name, node.title],
  );
}

it.each([
  ['[ptext text="a b#c"]', LEGACY, { text: "ab=c" }], // 旧版删除引号内空格，并把 `#` 还原为等号。
  ['[ptext text="a b#c"]', MODERN, { text: "a b#c" }],
  ['[ptext text="a b"]', { parser: "modern", keep_space: "1" } as const, { text: "ab" }],
  ["[ptext text=`a b`]", { parser: "modern", keep_space: "1" } as const, { text: "a b" }],
  ['[ptext text=" a "]', { parser: "modern", keep_space: "3" } as const, { text: " a " }],
  ['[ptext text="a\\"b" x=1]', MODERN, { text: 'a"b', x: "1" }],
  ["[ptext text = 'v' size= 2]", LEGACY, { text: "v", size: "2" }],
])("参数按版本语义解码：%s", (source, syntax, pm) => {
  expect(view(source, syntax)).toEqual([["ptext", pm]]);
});

it("正文转义与方括号只在新版成立", () => {
  expect(view("a\\[b]c", MODERN)).toEqual([["text", "a[b]c"]]);
  expect(view("a\\[b]c", LEGACY)).toEqual([
    ["text", "a\\"],
    ["b", {}],
    ["text", "c"],
  ]);
  expect(view('[t k="]"]x', MODERN)).toEqual([
    ["t", { k: "]" }],
    ["text", "x"],
  ]);
});

it("行级语法、脚本与 HTML 模式按引擎顺序识别", () => {
  const source = [
    "/*",
    "注释[p]",
    "*/",
    "; 注释",
    "#akane:happy",
    "*start|开始",
    "@bg storage=room.jpg",
    "_  #前导[r]",
    "[iscript]",
    "*not_label = 1",
    "var s = '[x]';",
    "[endscript]",
    "[html]<p>文字</p>[endhtml]",
  ].join("\r\n");
  expect(view(source, MODERN)).toEqual([
    ["#", "akane", "happy"],
    ["*", "start", "开始"],
    ["bg", { storage: "room.jpg" }],
    ["text", "  #前导"],
    ["r", {}],
    ["iscript", {}],
    ["*", "not_label = 1", ""], // 引擎在脚本模式中仍先识别行首符号。
    ["script", "var s = '[x]';"],
    ["endscript", {}],
    ["html", {}],
    ["html", "<p>文字</p>"],
    ["endhtml", {}],
  ]);
});

it("参数范围经单独解码复核，转义状态跨参数延续时不登记", () => {
  const text = "[t a=\"x\" b='y z']";
  const [node] = scan_scene(text, MODERN).nodes;
  expect(
    node?.kind === "tag" && node.params.map((param) => text.slice(param.start, param.end)),
  ).toEqual(['"x"', "'y z'"]);
  const carried = scan_scene('[t a="\\x" b="y"]', MODERN).nodes[0]!;
  expect(carried.kind === "tag" && carried.params.map((param) => param.key)).toEqual([]);
});

it("静态字符表达式往返任意文本，只接受本产品生成的形状", () => {
  for (const value of ["", "a b [x] \"'`\\\n😀", "长".repeat(5000)])
    expect(decode_static_text(encode_static_text(value))).toBe(value);
  for (const value of [
    "&String.fromCharCode(065)",
    "&String.fromCharCode(65536)",
    "&String.fromCharCode(65);alert(1)",
    "&eval(1)",
    "String.fromCharCode(65)",
  ])
    expect(decode_static_text(value)).toBeNull();
});
