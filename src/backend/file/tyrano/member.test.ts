import { expect, it } from "vitest";
import type { Item } from "../../../domain/item";
import { read_tyrano_member, render_tyrano_member } from "./member";
import type { SceneSyntax } from "./scene";

const LEGACY: SceneSyntax = { parser: "legacy", keep_space: "" };
const MODERN: SceneSyntax = { parser: "modern", keep_space: "" };
const FILE = "data/scenario/a.ks";

/** 通过成员入口读取场景或脚本，测试直接消费条目和诊断。 */
function read(source: string, syntax: SceneSyntax, file = FILE) {
  return read_tyrano_member(Buffer.from(source), file, syntax);
}
/** 按原文给条目填入译文，返回写回后的文本。 */
function render(
  source: string,
  syntax: SceneSyntax,
  translations: Record<string, string>,
  file = FILE,
): string {
  const items = read(source, syntax, file).items.map((item): Item =>
    item.src in translations
      ? { ...item, status: "PROCESSED", dst: translations[item.src]! }
      : item,
  );
  return Buffer.from(render_tyrano_member(Buffer.from(source), file, syntax, items)).toString();
}
const usage = (item: Item) => (item.extra_field as { tyrano: { usage: string } }).tyrano.usage; // 用途来自持久化元数据。

it("用途决定默认状态，ASCII 程序参数与宏参数引用不进入条目", () => {
  const source = [
    '[chara_new name="あかね" jname="アカネ" storage="a.png"]',
    "#アカネ:smile",
    '[glink text="開始" target=*start exp="f.a=\'甲\'" color=red]',
    '[mymacro label="ラベル" ref=%label code=&f.name]',
    "台詞[p]",
    "[iscript]",
    "alert('通知');",
    "[endscript]",
    "[html]<b>強調</b>[endhtml]",
    '[voconfig name="Akane" vostorage="a_{number}.ogg" number=1]',
    "#Akane",
    "[bg storage=room.jpg time=1000]",
  ].join("\n");
  const { items, warnings } = read(source, MODERN);
  expect(warnings).toEqual([]);
  expect(items.map((item) => [item.src, usage(item), item.status])).toEqual([
    ["あかね", "parameter", "RULE_SKIPPED"],
    ["アカネ", "name", "RULE_SKIPPED"],
    ["アカネ", "name", "RULE_SKIPPED"],
    ["開始", "text", "NONE"],
    ["f.a='甲'", "code", "RULE_SKIPPED"],
    ["ラベル", "parameter", "RULE_SKIPPED"],
    ["台詞", "text", "NONE"],
    ["<b>強調</b>", "code", "RULE_SKIPPED"],
    ["Akane", "parameter", "RULE_SKIPPED"], // 语音查找键与姓名一起协调。
    ["Akane", "name", "RULE_SKIPPED"],
    ["通知", "code", "RULE_SKIPPED"],
  ]);
  expect(read("&f.text[p]", LEGACY).items.map(usage)).toEqual(["code"]); // 旧版正文也展开实体。
});

it("优先普通写法，无法无损表示时改用静态字符表达式，重导入恢复同一译文且输出稳定", () => {
  const source = '#名前\n台詞[r]\n[glink text="開始"]\n';
  const translations = { 名前: "#Name", 台詞: "Line [one]", 開始: "Start game" };
  const modern = render(source, MODERN, translations);
  expect(modern).toBe('##Name\nLine \\[one][r]\n[glink text="Start game"]\n'); // 引擎只去掉首个 `#`。
  const legacy = render(source, LEGACY, translations);
  expect(legacy).toMatch(
    /^##Name\n\[text val="&String\.fromCharCode\(.*\)"\]\[r\]\n\[glink text="&String/u,
  );
  for (const [syntax, output] of [
    [MODERN, modern],
    [LEGACY, legacy],
  ] as const) {
    expect(read(output, syntax).items.map((item) => item.src)).toEqual(Object.values(translations));
    expect(render(source, syntax, translations)).toBe(output);
  }
  expect(render(source, LEGACY, { 台詞: "译文" })).toBe('#名前\n译文[r]\n[glink text="開始"]\n');
});

it("脚本字符串保留场景结构，合并多行的写回与代码位置的编码被拒绝", () => {
  const source = "[iscript]\nalert('通知');\n[endscript]\n[eval exp=\"f.a='甲'\"]\n";
  const output = render(source, MODERN, { 通知: "endscript 完成" });
  expect(output).toContain('alert("\\x65ndscript 完成")');
  expect(read(output, MODERN).items.map((item) => item.src)).toEqual([
    "f.a='甲'",
    "endscript 完成",
  ]);
  // 多行模板字符串写成一行会减少脚本节点，改变其后的标签序号。
  const template = "[iscript]\nf.a = `第一行\n第二行`;\n[endscript]\n*after\n";
  expect(() => render(template, MODERN, { "第一行\n第二行": "line" })).toThrow(/scene structure/u);
  // 新版参数值含反斜杠时没有普通写法，代码又不能改成字面文本。
  expect(() => render(source, MODERN, { "f.a='甲'": "f.a='乙\\n'" })).toThrow(
    /cannot be represented/u,
  );
});

it("写回保留 BOM 与未修改字节，过期定位拒绝写回", () => {
  const source = "\uFEFF台詞[p]\r\n  其他  [p]\r\n";
  expect(render(source, MODERN, { 台詞: "译文" })).toBe("\uFEFF译文[p]\r\n  其他  [p]\r\n");
  const [item] = read(source, MODERN).items;
  expect(() =>
    render_tyrano_member(Buffer.from(source), FILE, MODERN, [
      { ...item!, src: "旧", status: "PROCESSED", dst: "新" },
    ]),
  ).toThrow(/Stale Tyrano location/u);
});

it("普通脚本文件按 JavaScript 字符串写回", () => {
  expect(render('alert("通知");', MODERN, { 通知: '完"成' }, "data/others/plugin/a.js")).toBe(
    'alert("完\\"成");',
  );
});
