import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "vite";

import { expect, it } from "vitest";
import { parse_ruby, select_ruby_strings, read_ruby_strings, write_ruby_strings } from "./ruby";

it.each([
  'puts "original"',
  "puts 'original'",
  "puts %q{original}",
  'puts "original#{value}tail"',
  "puts %Q{original#{value}tail}",
  "puts <<TEXT\noriginal\nTEXT\n",
  "puts <<~TEXT\n  original #{value}\nTEXT\n",
  "puts %w[original tail]",
  'puts "original" "tail"',
  "puts %W[original#{value}tail]",
  'puts <<~TEXT\n  original #{format("inner")} tail\nTEXT\n',
])("特殊字符译文保留 Ruby 字符串值和合法语法：%s", async (source) => {
  const result = await read_ruby_strings(source);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const dst = '译文 " \\ #{literal} [x] {y}\n第二行😀';
  const output = await write_ruby_strings(
    source,
    result.strings.map((span) => ({ span, src: span.src, dst })),
  );
  const parsed = await read_ruby_strings(output);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.strings.map((span) => span.src)).toEqual(result.strings.map(() => dst));
});
it("普通字符串保留定位，符号正则命令和字符不作为字符串提取", async () => {
  const result = await read_ruby_strings(
    'require "module"; Cache.picture("face"); puts "display"; :symbol; /regexp/; `command`; ?a',
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.strings.map((span) => span.src)).toEqual(["module", "face", "display"]);
  expect((await read_ruby_strings('puts "unfinished')).ok).toBe(false);
});
it("相同编辑合并，拒绝失效坐标和冲突译文", async () => {
  const source = 'puts "original"',
    parsed = await read_ruby_strings(source);
  if (!parsed.ok) throw Error();
  const span = parsed.strings[0]!,
    change = { span, src: span.src, dst: "译文" };
  await expect(write_ruby_strings(source, [change, change])).resolves.toBe('puts "译文"');
  await expect(write_ruby_strings(source, [change, { ...change, dst: "冲突" }])).rejects.toThrow(
    "Conflicting",
  );
  await expect(write_ruby_strings(source, [{ ...change, src: "stale" }])).rejects.toThrow();
});

it("%W 插值中的独立字符串保持自身语法", async () => {
  const source = '%W[outer#{call("inner")}tail]';
  const parsed = await read_ruby_strings(source);
  if (!parsed.ok) throw Error("Invalid fixture");
  const span = parsed.strings.find((value) => value.src === "inner")!;
  const output = await write_ruby_strings(source, [{ span, src: "inner", dst: "译文" }]);
  const result = await read_ruby_strings(output);
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.strings.map((value) => value.src)).toEqual(["outer", "译文", "tail"]);
});

it("翻译筛选排除的语法节点仍可使用已保存范围写回", async () => {
  const source = ':"#{call("hidden")}"';
  const parsed = await parse_ruby(source);
  if (!parsed.ok) throw Error("Invalid fixture");
  expect(select_ruby_strings(parsed.syntax)).toEqual([]);
  const syntax = [...parsed.syntax.strings.values()].find(
    (entry) => entry.node.unescaped.value === "hidden",
  )!;
  const saved = JSON.parse(JSON.stringify(syntax.location));
  expect(Object.keys(saved)).toEqual(["start", "end"]);
  const output = await write_ruby_strings(source, [{ span: saved, src: "hidden", dst: "译文" }]);
  expect(output).toBe(':"#{call("译文")}"');
});
it("词数组的空译文保留空字符串元素", async () => {
  const source = '%W[first#{call("inner")} tail]';
  const parsed = await read_ruby_strings(source);
  if (!parsed.ok) throw Error("Invalid fixture");
  const span = parsed.strings.find((entry) => entry.src === "tail")!;
  const output = await write_ruby_strings(source, [{ span, src: "tail", dst: "" }]);
  expect(output).toBe('["first#{call("inner")}", ""]');
});

it.each([false, true])(
  "外层 heredoc 重建时保留嵌套 heredoc 的值：同时修改内部=%s",
  async (change_inner) => {
    const source = "puts <<OUTER\nbefore #{<<INNER}\ninside\nINNER\nafter\nOUTER\n";
    const parsed = await read_ruby_strings(source);
    if (!parsed.ok) throw Error("Invalid fixture");
    const selected = parsed.strings.filter(
      (span) => span.src === "before " || (change_inner && span.src === "inside\n"),
    );
    const output = await write_ruby_strings(
      source,
      selected.map((span) => ({
        span,
        src: span.src,
        dst: span.src === "before " ? "前文" : "内部",
      })),
    );
    expect(output).toBe(
      change_inner ? 'puts "前文#{"内部"}\\nafter\\n"\n' : 'puts "前文#{"inside\\n"}\\nafter\\n"\n',
    );
  },
);

it("部署目录的 Prism WASM 在仓库外 Electron 主线程和 worker 中解析并写回", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-runtime-"));
  const runtime =
    process.env["LINGUAGACHA_TEST_WORKSPACE_RUNTIME"] ?? path.resolve("build/resources/workspace");
  const electron =
    process.env["LINGUAGACHA_TEST_ELECTRON"] ??
    (createRequire(import.meta.url)("electron") as string);
  const entry = path.join(temp.path, "entry.ts");
  fs.writeFileSync(
    entry,
    `
    import assert from 'node:assert/strict';
    import {Worker,isMainThread,workerData} from 'node:worker_threads';
    import {configure_rgss_parser,read_ruby_strings,write_ruby_strings} from ${JSON.stringify(pathToFileURL(path.resolve("src/backend/file/rpgmaker-rgss/ruby.ts")).href)};
    const runtime=isMainThread?process.argv[2]:workerData;
    configure_rgss_parser(runtime);
    const source='puts "日本語"',parsed=await read_ruby_strings(source);assert(parsed.ok);
    const span=parsed.strings[0];
    const output=await write_ruby_strings(source,[{span,src:span.src,dst:'中文😀'}]);
    const result=await read_ruby_strings(output);assert(result.ok);assert.equal(result.strings[0].src,'中文😀');
    if(isMainThread){await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:runtime});worker.on('error',reject);worker.on('exit',code=>code===0?resolve():reject(Error(String(code))));});console.log('rgss-runtime-ok');}
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
  expect(result.stdout).toContain("rgss-runtime-ok");
}, 60000);
