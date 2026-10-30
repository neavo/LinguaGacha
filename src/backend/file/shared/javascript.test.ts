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
  configure_javascript_parser,
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
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-js-missing-parser-"));
  const parser = path.join(temp.path, "node_modules/oxc-parser");
  fs.mkdirSync(parser, { recursive: true });
  fs.writeFileSync(path.join(parser, "package.json"), '{"main":"index.cjs"}');
  fs.writeFileSync(path.join(parser, "index.cjs"), 'throw new Error("parser unavailable");');
  configure_javascript_parser(temp.path);
  try {
    expect(() => read_javascript_strings('say("正文")')).toThrow("parser unavailable");
  } finally {
    configure_javascript_parser(path.resolve("."));
  }
});

it("普通字符串与模板片段保留 UTF-16 范围及完整性", () => {
  const source = 'f("甲😀", `乙😀`, `丙${name}丁`);';
  const spans = read_strings(source);
  expect(spans).toEqual([
    { start: 2, end: 7, src: "甲😀", template: false, complete: true },
    { start: 10, end: 13, src: "乙😀", template: true, complete: true },
    { start: 17, end: 18, src: "丙", template: true, complete: false },
    { start: 25, end: 26, src: "丁", template: true, complete: false },
  ]);
  expect(spans.map(({ start, end }) => source.slice(start, end))).toEqual([
    '"甲😀"',
    "乙😀",
    "丙",
    "丁",
  ]);
});

it("仓库外 Electron 从部署目录加载原生绑定并生成可解析的字符串写回", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-js-deployment-"));
  const runtime =
    process.env["LINGUAGACHA_TEST_WORKSPACE_RUNTIME"] ?? path.resolve("build/resources/workspace");
  const electron =
    process.env["LINGUAGACHA_TEST_ELECTRON"] ??
    (createRequire(import.meta.url)("electron") as string);
  const entry = path.join(temp.path, "entry.ts");
  const module = pathToFileURL(path.resolve("src/backend/file/shared/javascript.ts")).href;
  fs.writeFileSync(
    entry,
    `
    import assert from "node:assert/strict";
    import {
      configure_javascript_parser,
      decode_javascript_string,
      encode_javascript_string,
      read_javascript_strings,
    } from ${JSON.stringify(module)};
    configure_javascript_parser(process.argv[2]);
    const source = 'const s = "中文😀";';
    const [span] = read_javascript_strings(source).strings;
    const value = '译文"\\\\😀';
    const output = source.slice(0, span.start) + encode_javascript_string(value, false) + source.slice(span.end);
    const parsed = read_javascript_strings(output);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.strings[0].src, value);
    assert.equal(decode_javascript_string(encode_javascript_string(value, false), false), value);
    console.log("javascript-deployment-ok");
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
  expect(result.stdout).toContain("javascript-deployment-ok");
}, 60000);

it.each(['"原文"; call(); "另一段"', "`原文`"])(
  "普通字面量解码拒绝多语句或错误模板类型：%s",
  (source) => {
    expect(() => decode_javascript_string(source, false)).toThrow();
  },
);
