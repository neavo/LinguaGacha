import { SOURCE_CONTEXT_MAX_LENGTH } from "./types";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "vite";
import { expect, it } from "vitest";
import {
  configure_rpgmaker_parser,
  decode_javascript_string,
  read_javascript_strings,
} from "./javascript";
/** 成功用例统一解包，语法诊断仍使测试失败。 */
function read_strings(source: string) {
  const result = read_javascript_strings(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.strings;
}

it("语法错误返回脚本内位置，错误前的字符串也不提取", () => {
  expect(read_javascript_strings('say("中文😀");\r\nif()')).toEqual({
    ok: false,
    diagnostics: [{ message: expect.stringMatching(/\S/u), line: 2, column: 4 }],
  });
});

it("解析器加载失败继续抛出", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-missing-parser-"));
  const parser = path.join(temp.path, "node_modules/oxc-parser");
  fs.mkdirSync(parser, { recursive: true });
  fs.writeFileSync(path.join(parser, "package.json"), '{"main":"index.cjs"}');
  fs.writeFileSync(path.join(parser, "index.cjs"), 'throw new Error("parser unavailable");');
  configure_rpgmaker_parser(temp.path);
  try {
    expect(() => read_javascript_strings('say("正文")')).toThrow("parser unavailable");
  } finally {
    configure_rpgmaker_parser(path.resolve("."));
  }
});

it.each([
  ['outer(inner("开始"));', 'inner("开始")'],
  ['new Label("开始");', 'new Label("开始")'],
  ['const title = "开始";', 'title = "开始"'],
  ['title = "开始";', 'title = "开始"'],
  ['const labels = { start: "开始" };', 'start: "开始"'],
  ['function f() { return "开始"; }', 'return "开始";'],
  ['const C = class { static { throw "开始"; } };', 'throw "开始";'],
  ['this.drawText(\n  "开始",\n  x\n);', 'this.drawText(\n  "开始",\n  x\n)'],
  ['"开始";', '"开始";'],
])("从原稿 %s 提取最近用途并保留原始排版", (source, context) => {
  expect(read_strings(source).map((span) => span.source_context)).toEqual([context]);
});

it("相邻节点退出后上下文不会串用，模板片段保留插值", () => {
  expect(read_strings('f("甲"); g(`乙${name}丙`);').map((span) => span.source_context)).toEqual([
    'f("甲")',
    "g(`乙${name}丙`)",
    "g(`乙${name}丙`)",
  ]);
});

it.each([
  'function f() { if (mode === "战斗") start(); }',
  'const f = function () { if (mode === "战斗") start(); };',
  '(function () { if (mode === "战斗") start(); })();',
  'register(function () { if (mode === "战斗") start(); });',
  'const f = () => { if (mode === "战斗") start(); };',
])("函数包装不改变局部语句上下文：%s", (source) => {
  expect(read_strings(source).map((span) => span.source_context)).toEqual([
    'if (mode === "战斗") start();',
  ]);
});

it.each([
  [
    'const label = () => enabled ? "开启" : "关闭";',
    ['enabled ? "开启" : "关闭"', 'enabled ? "开启" : "关闭"'],
  ],
  ["const label = () => `你好${name}世界`;", ["`你好${name}世界`", "`你好${name}世界`"]],
  ['const label = (text = "默认") => "正文";', ['"默认"', '"正文"']],
  ["register(function (text = `你好${name}`) {});", ["`你好${name}`"]],
])("函数内没有用途节点时使用局部兜底：%s", (source, contexts) => {
  expect(read_strings(source).map((span) => span.source_context)).toEqual(contexts);
});

it("长语句围绕目标摘录，长字符串优先保留开头，截断不拆开代理对", () => {
  const source = `f(/*${"😀".repeat(1000)}*/"目标",/*${"😀".repeat(1000)}*/x);`;
  const context = read_strings(source)[0]!.source_context;
  expect(context).toContain('"目标"');
  expect(context.startsWith("…")).toBe(true);
  expect(context.endsWith("…")).toBe(true);
  expect(context.length).toBeLessThanOrEqual(SOURCE_CONTEXT_MAX_LENGTH);
  expect(context.isWellFormed()).toBe(true);
  const long = read_strings(`f("开始${"😀".repeat(1000)}");`)[0]!;
  expect(long.src).toBe(`开始${"😀".repeat(1000)}`);
  expect(long.source_context.startsWith('f("开始')).toBe(true);
  expect(long.source_context.endsWith("…")).toBe(true);
  expect(long.source_context.length).toBeLessThanOrEqual(SOURCE_CONTEXT_MAX_LENGTH);
  expect(long.source_context.isWellFormed()).toBe(true);
});

it("仓库外 Electron 从部署目录加载原生绑定并生成可解析译文文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-deployment-"));
  const runtime =
    process.env["LINGUAGACHA_TEST_WORKSPACE_RUNTIME"] ?? path.resolve("build/resources/workspace");
  const electron =
    process.env["LINGUAGACHA_TEST_ELECTRON"] ??
    (createRequire(import.meta.url)("electron") as string);
  const entry = path.join(temp.path, "entry.ts");
  const module = path.resolve("src/backend/file/rpgmaker-mv-mz");
  fs.writeFileSync(
    entry,
    `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { create_rpgmaker_mv_mz_adapter } from ${JSON.stringify(pathToFileURL(path.join(module, "rpgmaker-format.ts")).href)};
    import { configure_rpgmaker_parser, read_javascript_strings } from ${JSON.stringify(pathToFileURL(path.join(module, "javascript.ts")).href)};
    configure_rpgmaker_parser(process.argv[2]);
    const format = create_rpgmaker_mv_mz_adapter({target_language:"ZH"}).create_members(new Map());
    const bytes = Buffer.from('const s = "中文😀";');
    const { items } = await format.read_file(bytes, "js/plugins/test.js");
    assert.equal(items.length, 1);
    items[0].status = "PROCESSED";
    items[0].dst = '译文"\\\\😀';
    const output = await format.render(bytes, "js/plugins/test.js", items);
    fs.writeFileSync("translated.js", output);
    const parsed = read_javascript_strings(fs.readFileSync("translated.js", "utf8"));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.strings[0].src, items[0].dst);
    const numericSource = '{"text":"source","n":9007199254740993,"overflow":1e400,"zero":-0}';
    const jsonBytes = Buffer.from(numericSource);
    const numericItems = (await format.read_file(jsonBytes, "data/Plugins.json")).items;
    numericItems[0].status = "PROCESSED";
    numericItems[0].dst = "translated";
    const numericOutput = await format.render(jsonBytes, "data/Plugins.json", numericItems);
    assert.equal(Buffer.from(numericOutput).toString(), numericSource.replace("source", "translated"));
    console.log("rpgmaker-deployment-ok");
  `,
  );
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: entry,
      target: "node24",
      outDir: path.join(temp.path, "bundle"),
      rolldownOptions: { output: { entryFileNames: "smoke.mjs" } },
    },
    ssr: { noExternal: true },
  });
  const result = await promisify(execFile)(
    electron,
    [path.join(temp.path, "bundle/smoke.mjs"), runtime],
    {
      cwd: temp.path,
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  assert.match(result.stdout, /rpgmaker-deployment-ok/u);
}, 60000);

it.each(['"原文"; call(); "另一段"', "`原文`"])(
  "普通字面量解码拒绝多语句或错误模板类型：%s",
  (source) => {
    expect(() => decode_javascript_string(source, false)).toThrow();
  },
);
