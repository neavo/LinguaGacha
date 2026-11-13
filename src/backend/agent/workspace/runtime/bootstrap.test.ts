import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentExecutionRuntime } from "../../execution/runtime";
import type { AgentWorkspaceRunRequest } from "./runner";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { inject, afterAll, beforeAll, expect, it, onTestFinished, vi } from "vitest";
import { AGENT_WORKSPACE_CONTRACT, AGENT_WORKSPACE_REFERENCES } from "../../tools/contract";
import { AgentWorkspaceRunner, AgentWorkspaceRunError } from "./runner";
import type { AgentProcessOutput } from "../../process-output";
import { AGENT_WORKSPACE_RUN_ROOT } from "./policy";
import { create_pdf_fixture } from "../../../file/pdf/test-support";
import { AGENT_IMAGE_MAX_EDGE } from "../../../../shared/agent-image";
import app_package from "../../../../../package.json";
import { MEDIA_MODELS } from "../../media/models";
import { DEFAULT_PYTHON_VERSION } from "../../uv/runtime";

const electron_path =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
const RUN_TIMEOUT_MS = 15_000; // 早于测试超时回收子进程，失败后目录清理也能完成
const EXECUTION_TIMEOUT_MS = 60_000; // 晚于外部取消信号，测试失败沿取消路径收尾
let root = "";
let runtime = "";
let workspace = "";
let sequence = 0;
let python_root = "";
const skill_paths = {
  get_agent_user_skill_dir: () => path.join(root, "user skills # %"),
  get_agent_builtin_skill_dir: () => path.join(root, "内置 skills"),
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "linguagacha-node-"));
  python_root = path.join(root, "python");
  runtime = path.join(root, "resources/workspace");
  workspace = path.join(root, "workspace");
  // 应用升级场景会改写 SDK 和 npm，使用本文件独占的部署副本。
  await cp(inject("workspaceRuntimeDirectory"), runtime, { recursive: true });
  await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(path.join(workspace, "contract.json"), JSON.stringify(AGENT_WORKSPACE_CONTRACT));
  for (const [relative_path, content] of Object.entries(AGENT_WORKSPACE_REFERENCES)) {
    await mkdir(path.dirname(path.join(workspace, relative_path)), { recursive: true });
    await writeFile(path.join(workspace, relative_path), content);
  }
}, 60_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it("媒体 SDK 使用宿主指定的模型目录并拒绝缺失模型的探查", async () => {
  const { file, size } = MEDIA_MODELS.vad;
  await run(`
    import assert from 'node:assert/strict';
    import { mkdir, writeFile, rm } from 'node:fs/promises';
    import path from 'node:path';
    import * as media from '@lg/media';
    const models = ${JSON.stringify(path.join(root, "media storage/models"))};
    const model = ${JSON.stringify({ file, size })};
    assert.ok((await media.missing_models()).includes(model.file));
    const file = path.join(models, model.file);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.alloc(model.size));
    assert.ok(!(await media.missing_models()).includes(model.file));
    try {
      await assert.rejects(media.probe_gpu(), /Media models are missing/);
    } finally {
      await rm(file);
    }
  `);
});

it("领域 SDK 通过绑定通道识别来源和生成文件，失败原因传回脚本", async () => {
  const generated = {
    accepted: true as const,
    output_path: path.join(workspace, "work/output/translated"),
    bilingual_output_path: path.join(workspace, "work/output/bilingual"),
    excluded_files: [],
    writeback: { input_path: path.join(workspace, "work/output/writeback"), files: [] },
    pdf_files: [],
  };
  const generateFiles = vi
    .fn(async () => generated)
    .mockRejectedValueOnce(new Error("fixture generation failed"));
  const inspectSources = vi.fn(async (sources: string[]) =>
    sources.map((source_path) => ({
      source_path,
      files: [{ path: source_path, kind: "file" as const }],
      godot_packs: [],
      failures: [],
    })),
  );
  const result = await run(
    `
    import { inspectSources, generateFiles, getOutputPaths } from '@lg/project';
    import assert from 'node:assert/strict';
    await assert.rejects(generateFiles([]), /fixture generation failed/);
    console.log(JSON.stringify({ sources: await inspectSources(['work/input.txt']), generated: await generateFiles([]), paths: await getOutputPaths(), selected: await getOutputPaths(${JSON.stringify(workspace)}) }));
  `,
    undefined,
    undefined,
    {
      inspectSources,
      generateFiles,
      getOutputPaths: (directory) => ({
        manual: directory === undefined,
        translated_path: workspace,
        bilingual_path: workspace,
      }),
    },
  );
  expect(output_content(result.stdout)).toEqual({
    generated,
    paths: { manual: true, translated_path: workspace, bilingual_path: workspace },
    selected: { manual: false, translated_path: workspace, bilingual_path: workspace },
    sources: [
      {
        source_path: "work/input.txt",
        files: [{ path: "work/input.txt", kind: "file" }],
        godot_packs: [],
        failures: [],
      },
    ],
  });
  expect(inspectSources).toHaveBeenCalledOnce();
});

it("搜索 SDK 经真实 IPC 保留原生响应并校验参数", async () => {
  const response = {
    provider: "tavily" as const,
    status: 200,
    contentType: "text/event-stream",
    body: 'data: {"result":{"isError":false,"content":[{"text":"quota exhausted"}]}}\n\n',
  };
  const search = vi.fn(async () => response);
  const result = await run(
    `
    import {search} from '@lg/search';
    import assert from 'node:assert/strict';
    await assert.rejects(search({query: ' '}), /Invalid workspace search request/);
    console.log(JSON.stringify(await search({query: 'fixture', provider: 'tavily'})));
  `,
    undefined,
    undefined,
    { search },
  );
  expect(output_content(result.stdout)).toEqual(response);
  expect(search).toHaveBeenCalledOnce();
});

it("停止搜索脚本会取消宿主请求并等它收尾", async () => {
  const controller = new AbortController();
  let host_signal: AbortSignal | undefined;
  const pending = run(
    "import {search} from '@lg/search'; await search({query:'fixture'});",
    controller.signal,
    undefined,
    {
      search: async (_input, signal) =>
        new Promise((_resolve, reject) => {
          host_signal = signal;
          signal.addEventListener(
            "abort",
            () => {
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    },
  );
  const stopped = new Error("stop search");
  const assertion = expect(pending).rejects.toBe(stopped);
  try {
    await vi.waitFor(() => expect(host_signal).toBeDefined(), { timeout: RUN_TIMEOUT_MS });
  } finally {
    controller.abort(stopped);
    await assertion;
  }
  expect(host_signal?.aborted).toBe(true);
});

it("独立部署目录支持原生模块、主程序身份、自然退出和异步输出", async () => {
  await mkdir(path.join(workspace, "work/scripts"));
  await writeFile(
    path.join(workspace, "work/scripts/helper.js"),
    "export const value = ws.contract.datasets.items.path;",
  );
  await writeFile(path.join(workspace, "work/scripts/helper.cjs"), "module.exports = 42;");
  const result = await run(`
    import fs from 'node:fs/promises';
    import { fileURLToPath } from 'node:url';
    import value from '../scripts/helper.cjs';
    import { value as itemPath } from '../scripts/helper.js';
    import '@lg/image'; // 仓库外部署必须能解析新 SDK 及其依赖。
    await fs.writeFile('work/state.json', JSON.stringify(value));
    console.log(JSON.stringify({ main: fileURLToPath(import.meta.url) === process.argv[1], value, itemPath }));
    console.error('ordinary stderr');
    setTimeout(() => { console.log('async finished'); }, 10);
    export default 1n;
  `);
  expect(result).toMatchObject({
    exitCode: 0,
    signal: null,
    stderr: { content: expect.stringContaining("ordinary stderr\n") },
  });
  expect(output_content(result.stdout)).toBe(
    `${JSON.stringify({ main: true, value: 42, itemPath: AGENT_WORKSPACE_CONTRACT.datasets.items!.path })}\nasync finished\n`,
  );
  expect(await readFile(path.join(workspace, result.stdout.path), "utf8")).toBe(
    output_content(result.stdout),
  );
  expect(
    (
      await run(
        "import fs from 'node:fs/promises'; console.log(await fs.readFile('work/state.json', 'utf8')); ",
      )
    ).stdout,
  ).toMatchObject({ content: "42\n" });
  const empty = await run("// 没有输出的普通程序也成功");
  expect(empty.exitCode).toBe(0);
  expect(empty.stdout).toMatchObject({ bytes: 0, content: "" });
  for (const output of [empty.stdout, empty.stderr]) {
    expect(await readFile(path.join(workspace, output.path), "utf8")).toBe(output_content(output));
  }
});

it("PDF 引擎与渲染 API 共用实例，Markdown 从用户 npm 工程加载", async () => {
  await writeFile(path.join(workspace, "work/source.pdf"), create_pdf_fixture());
  const result = await run(`
    import { readFile } from 'node:fs/promises';
    import assert from 'node:assert/strict';
    import * as mupdf from '@lg/pdf/mupdf';
    import {renderPdfPage} from '@lg/pdf';
    import { unified } from 'unified';
    import remarkParse from 'remark-parse';
    import remarkGfm from 'remark-gfm';
    const loadPage = mupdf.PDFDocument.prototype.loadPage;
    let rendered = false;
    mupdf.PDFDocument.prototype.loadPage = function(index) {
      rendered = true;
      return loadPage.call(this, index);
    };
    const pdf = new mupdf.PDFDocument(new Uint8Array(await readFile('work/source.pdf')));
    try {
      const page = pdf.loadPage(0); const text = page.toStructuredText();
      try {
        rendered = false;
        const buffer = pdf.saveToBuffer('');
        let image;
        try { image = renderPdfPage(buffer.asUint8Array(), {page:3,scale:1}); }
        finally { buffer.destroy(); }
        assert.equal(rendered, true, 'PDF API 必须使用公开引擎的同一原型');
        console.log(JSON.stringify({ pages:pdf.countPages(), text:text.asText(), image:image.length, markdown:unified().use(remarkParse).use(remarkGfm).parse('# Title').children[0].type }));
      }
      finally { text.destroy(); page.destroy(); }
    } finally { pdf.destroy(); }

  `);
  expect(result.exitCode).toBe(0);
  expect(JSON.stringify(output_content(result.stdout))).toContain("First half");
  expect(JSON.stringify(output_content(result.stdout))).toContain("heading");
});

it.each(["user", "builtin"])(
  "%s 原目录技能直接导入相对模块、npm 与应用模板，并通过 IPC 调用宿主",
  async (kind) => {
    await writeFile(path.join(workspace, "work/source.pdf"), create_pdf_fixture());
    await writeFile(
      path.join(workspace, "work/printed.pdf"),
      create_pdf_fixture(["Printed fixture"]),
    );
    const source = path.join(
      kind === "user"
        ? skill_paths.get_agent_user_skill_dir()
        : skill_paths.get_agent_builtin_skill_dir(),
      "fixture",
    );
    await mkdir(path.join(source, "scripts"), { recursive: true });
    await writeFile(path.join(source, "scripts/helper.mjs"), "export const title = 'fixture';");
    await writeFile(
      path.join(source, "scripts/entry.mjs"),
      `
    import { unified } from 'unified';
    import remarkParse from 'remark-parse';
    import { buildPdfDocument } from '@lg/pdf';
    import { readFile, writeFile } from 'node:fs/promises';
    import { title } from './helper.mjs';
    import { queryItemContexts } from '@lg/project';
    import { compileLiteralPatterns } from '@lg/utils/literal-matcher';
    export async function inspect() {
      await writeFile('work/items.jsonl', JSON.stringify({item_id:1,file_path:'a',src:'Straße'}));
      const contexts = await queryItemContexts([JSON.parse(await readFile('work/items.jsonl', 'utf8'))], [1]);
      const matcher = compileLiteralPatterns([{key:'street',text:'STRASSE',case_sensitive:false}]);
      if (contexts.items.length !== 1 || !matcher.matches(contexts.items[0].src)) throw new Error('Item contexts or text import failed');
      const bytes = await buildPdfDocument({
        title, source_bytes: new Uint8Array(await readFile('work/source.pdf')),
        document:{digest:'a'.repeat(64),pages:[1,2,3].map(page=>({page,width:300,height:300,rotation:0,label:null,translation:page===2?{kind:'translate',markdown:'# fixture'}:null,reviewed:false,notes:''}))},
      });
      await writeFile('work/fixture.pdf', bytes);
      return {type:unified().use(remarkParse).parse('# fixture').children[0].type,path:'work/fixture.pdf'};
    }
  `,
    );
    const entry_url = pathToFileURL(path.join(source, "scripts/entry.mjs")).href;
    const result = await run(
      `
    const {inspect} = await import(${JSON.stringify(entry_url)});
    const result = await inspect();
    console.log(JSON.stringify(result));
  `,
      undefined,
      undefined,
      {
        printPDF: async (request) => {
          expect(request.kind).toBe("print_pdf");
          expect(request.html).toContain("fixture");
          return { path: path.join(workspace, "work/printed.pdf") };
        },
      },
    ).catch((error: unknown) => {
      if (error instanceof AgentWorkspaceRunError)
        throw new Error(JSON.stringify(error.execution), { cause: error });
      throw error;
    });
    await expect(readFile(path.join(workspace, "work/printed.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(output_content(result.stdout)).toEqual({
      type: "heading",
      path: "work/fixture.pdf",
    });
  },
);

it("网页流、重定向与代理等待在真实子进程中工作", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/page" });
      response.end();
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<article><h1>Hello</h1><p><a href="/target">世界</a></p></article>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server address");
  const url = `http://127.0.0.1:${address.port}/redirect`;
  try {
    const result = await run(`
      const response = await fetch(${JSON.stringify(url)});
      const text = await response.text();
      const streamed = await fetch(${JSON.stringify(url)});
      let html = '';
      for await (const chunk of streamed.body.pipeThrough(new TextDecoderStream())) html += chunk;
      console.log(JSON.stringify({ text, html, url: response.url }));
    `);
    expect(output_content(result.stdout)).toEqual({
      text: '<article><h1>Hello</h1><p><a href="/target">世界</a></p></article>',
      html: '<article><h1>Hello</h1><p><a href="/target">世界</a></p></article>',
      url: `http://127.0.0.1:${address.port}/page`,
    });
    // 先收到代理请求，再返回错误。等待宿主期间 IPC 必须维持子进程存活。
    const ready = Promise.withResolvers<void>();
    const proxy = Promise.withResolvers<never>();
    const pending = run(
      "try { await fetch('https://example.invalid'); } catch (error) { console.log(error.cause.message); }",
      undefined,
      async () => {
        ready.resolve();
        return await proxy.promise;
      },
    );
    await ready.promise;
    proxy.reject(new Error("fixture proxy failure"));
    expect(output_content((await pending).stdout)).toContain("fixture proxy failure");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("预置 aria2 通过工作区 PATH 和应用代理下载", async () => {
  const bytes = Buffer.from("aria2 fixture 中文内容\n");
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/redirect")) {
      response.writeHead(302, { location: "http://download.invalid/data" });
      response.end();
    } else response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const routes: string[] = [];
  try {
    await run(
      `
      import { execFileSync } from 'node:child_process';
      execFileSync('aria2c', [
        '--no-conf', '--dir=work', '--out=download.bin', 'http://download.invalid/redirect'
      ], { stdio: 'inherit', windowsHide: true });
    `,
      undefined,
      async (url) => {
        routes.push(url);
        return `PROXY 127.0.0.1:${address.port}`;
      },
    );
    expect(await readFile(path.join(workspace, "work/download.bin"))).toEqual(bytes);
    expect(routes).toContain("http://download.invalid/redirect");
    expect(routes).toContain("http://download.invalid/data");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("取消在途代理等待后回收进程，并解除宿主请求", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let proxy_signal: AbortSignal | undefined;
  const controller = new AbortController();
  const pending = run(
    "console.log('before wait'); await fetch('https://example.invalid/pending');",
    controller.signal,
    async (_url, signal) => {
      proxy_signal = signal;
      started();
      return await new Promise<string>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  );
  const rejected = expect(pending).rejects.toThrow("stop");
  try {
    await Promise.race([ready, pending]);
  } finally {
    controller.abort(new Error("stop"));
  }
  await rejected;
  expect(proxy_signal?.aborted).toBe(true);
  expect(
    await readFile(
      path.join(workspace, `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stdout.log`),
      "utf8",
    ),
  ).toBe("before wait\n");
});

it("脚本主动取消代理等待后解除 IPC 保活并自然退出", async () => {
  const started = Promise.withResolvers<void>();
  let proxy_signal: AbortSignal | undefined;
  const server = createServer((_request, response) => {
    void started.promise.then(() => response.end("ready"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server address");
  try {
    const result = await run(
      `
      const controller = new AbortController();
      const reason = new Error('script stop');
      const pending = fetch('https://example.invalid/pending', { signal: controller.signal }).catch(error => {
        if (error !== reason) throw error;
        console.log(error.message);
      });
      await (await fetch('http://127.0.0.1:${address.port}/ready')).text();
      controller.abort(reason);
      await pending;
      console.log('finished');
    `,
      undefined,
      async (_url, signal) => {
        proxy_signal = signal;
        started.resolve();
        return await new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    );
    expect(result).toMatchObject({ exitCode: 0, signal: null });
    expect(output_content(result.stdout)).toBe("script stop\nfinished\n");
    expect(proxy_signal?.aborted).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([false, true])(
  "工作区祖先、部署目录和工作材料目录支持链接（work 本身链接：%s）",
  async (mount_work) => {
    const directory = await mkdtemp(path.join(root, "linked-"));
    const data = path.join(directory, "data");
    const data_link = path.join(directory, "data-link");
    const runtime_link = path.join(directory, "runtime-link");
    const actual_workspace = path.join(data, "workspace");
    const logical_workspace = path.join(data_link, "workspace");
    const external = path.join(directory, "external");
    const link_type = process.platform === "win32" ? "junction" : "dir";
    await mkdir(actual_workspace, { recursive: true });
    await mkdir(external);
    await symlink(data, data_link, link_type);
    await symlink(runtime, runtime_link, link_type);
    try {
      if (mount_work) await symlink(external, path.join(logical_workspace, "work"), link_type);
      else await mkdir(path.join(logical_workspace, "work"));
      await symlink(external, path.join(logical_workspace, "work", "output"), link_type);
      await writeFile(path.join(external, "helper.mjs"), "export const title = 'linked';");
      await writeFile(
        path.join(logical_workspace, "contract.json"),
        JSON.stringify(AGENT_WORKSPACE_CONTRACT),
      );
      await writeFile(
        path.join(logical_workspace, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      await mkdir(path.join(logical_workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
      const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/task.mjs`;
      await writeFile(
        path.join(logical_workspace, scriptPath),
        `
      import { unified } from 'unified';
      import remarkParse from 'remark-parse';
      import { title } from '../output/helper.mjs';
      console.log(unified().use(remarkParse).parse('# ' + title).children[0].children[0].value);
    `,
      );
      const result = await new AgentWorkspaceRunner({
        paths: skill_paths,
        execution: create_execution_runtime(runtime_link),
        proxyResolver: { resolveProxy: async () => "DIRECT" },
      }).run(
        {
          workspacePath: logical_workspace,
          scriptPath,
          stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/task.stdout.log`,
          stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/task.stderr.log`,
          timeoutMs: EXECUTION_TIMEOUT_MS,
        },
        AbortSignal.timeout(RUN_TIMEOUT_MS),
      );
      expect(result.exitCode).toBe(0);
      expect(output_content(result.stdout)).toMatch(/^linked\s*$/u);
    } finally {
      await unlink(data_link);
      await unlink(runtime_link);
    }
  },
);

it("取消包源查询时通过真实 IPC 解除宿主请求", async () => {
  const closed_proxy = async () => "PROXY 127.0.0.1:9";
  const started = Promise.withResolvers<AbortSignal>();
  const controller = new AbortController();
  const pending = run(
    "import { npm } from '@lg/npm'; await npm.run(['view', 'lg-missing']);",
    controller.signal,
    closed_proxy,
    {
      packageSource: async (signal) => {
        started.resolve(signal);
        return await new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      },
    },
  );
  const rejected = expect(pending).rejects.toThrow("stop");
  let source_signal: AbortSignal | undefined;
  try {
    source_signal = await Promise.race([started.promise, pending.then(() => undefined)]);
  } finally {
    controller.abort(new Error("stop"));
  }
  await rejected;
  expect(source_signal?.aborted).toBe(true);
});

it("doing 在真实 IPC 回包后已生效，程序仍运行且后续失败保留阶段", async () => {
  let text: string | null = null;
  let release = (): void => undefined;
  let ready = (): void => undefined;
  // 代理请求暂停后续步骤，以明确的完成信号观察 IPC 写入时序。
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const write = async (value: string | null): Promise<void> => {
    text = value;
  };
  let settled = false;
  const pending = run(
    `
    import assert from 'node:assert/strict';
    await ws.setDoing(' 检查章节 ');
    await assert.rejects(ws.setDoing(''));
    await fetch('https://example.test/hold');
    `,
    undefined,
    async () => {
      ready();
      await blocked;
      throw new Error("后续执行失败");
    },
    { doing: write },
  ).finally(() => {
    settled = true;
  });
  const rejected = expect(pending).rejects.toBeInstanceOf(AgentWorkspaceRunError);
  try {
    await Promise.race([waiting, pending]);
    expect(text).toBe("检查章节");
    expect(settled).toBe(false);
  } finally {
    release();
    await rejected;
  }
  expect(text).toBe("检查章节");
});

it("emitImage 通过真实 IPC 等待接收，宿主拒绝可由脚本捕获", async () => {
  const paths: string[] = [];
  const edges: (number | undefined)[] = [];
  const result = await run(
    `
    await ws.emitImage('work/第一页.webp');
    try { await ws.emitImage('invalid'); } catch (error) { console.log(error.message); }
    for (const options of [{maxEdge: 0}, {maxEdge: ${AGENT_IMAGE_MAX_EDGE + 1}}, {maxEdge: 1.5}, {maxEdge: '1920'}, {other: 1}]) {
      try { await ws.emitImage('invalid-options', options); throw new Error('accepted invalid options'); }
      catch (error) { if (!error.message.includes('Invalid workspace image request')) throw error; }
    }
    await ws.emitImage('work/第二页.webp', { maxEdge: ${AGENT_IMAGE_MAX_EDGE} });
  `,
    undefined,
    undefined,
    {
      emitImage: async (path, _signal, options) => {
        if (path === "invalid") throw new Error("image rejected");
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        paths.push(path);
        edges.push(options?.maxEdge);
      },
    },
  );
  expect(paths).toEqual(["work/第一页.webp", "work/第二页.webp"]);
  expect(edges).toEqual([undefined, AGENT_IMAGE_MAX_EDGE]);
  expect(output_content(result.stdout)).toContain("image rejected");
});

it("页面更新模块在部署工作区解析记录并判定目标", async () => {
  const result = await run(`
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === 'mupdf') throw new Error('工作区数据模块不应初始化 PDF 引擎');
      return nextResolve(specifier, context);
    }});
    await import('@lg/project');
    const { parsePageUpdate, resolvePageUpdates } = await import('@lg/pdf/page-updates');
    const value = {file_path:'sample.pdf',page:1,fp:'abcd',translation:null,reviewed:false,notes:''};
    const valid = parsePageUpdate({line:2,value});
    const missing = resolvePageUpdates([valid.intent], []);
    console.log(JSON.stringify(missing.rejected));
  `);
  expect(output_content(result.stdout)).toMatchObject([{ reason: "target_missing", line: 2 }]);
});

it("模型说明列出的预装包都能导入", async () => {
  const result = await run(`
    const failed = [];
    for (const name of ${JSON.stringify(app_package.workspaceRuntimePackages.agent)}) {
      try { await import(name); } catch { failed.push(name); }
    }
    console.log(JSON.stringify(failed));
  `);
  expect(output_content(result.stdout)).toEqual([]);
});

it("切换应用目录直接更新 SDK，保留用户工程且不调用 npm", async () => {
  await run("// 初始化用户工程。");
  const shared = path.join(root, "shared node");
  const updated = path.join(root, "新版应用 # 空格/workspace");
  await cp(runtime, updated, { recursive: true });
  const fixture = "@lg/runtime-fixture";
  try {
    for (const [directory, value] of [
      [runtime, "v1"],
      [updated, "v2"],
      [shared, "user"],
    ] as const) {
      const target = path.join(directory, "node_modules", fixture);
      await mkdir(target, { recursive: true });
      await writeFile(
        path.join(target, "package.json"),
        JSON.stringify({ name: fixture, type: "module", exports: "./index.mjs" }),
      );
      await writeFile(path.join(target, "index.mjs"), `export default '${value}';`);
    }
    const files = [
      "package.json",
      "package-lock.json",
      "npmrc",
      "node_modules/@lg/runtime-fixture/index.mjs",
    ];
    const before = await Promise.all(
      files.map((file) => readFile(path.join(shared, file), "utf8")),
    );
    // 更新应用时 npm 不参与准备，任何意外调用都应立即使测试失败。
    await writeFile(
      path.join(updated, "npm/bin/npm-cli.js"),
      "throw new Error('SDK update must not call npm');",
    );
    for (const [directory, version] of [
      [runtime, "v1"],
      [updated, "v2"],
    ] as const) {
      const result = await run(
        `
        import assert from 'node:assert/strict';
        import version from '${fixture}';
        for (const name of ['@lg/project/bootstrap', '@lg/project/prepare', '@lg/pdf/worker', '@lg/utils']) {
          await assert.rejects(import(name), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
        }
        console.log(version);
        `,
        undefined,
        undefined,
        {},
        directory,
      );
      expect(output_content(result.stdout)).toBe(`${version}\n`);
    }
    expect(
      await Promise.all(files.map((file) => readFile(path.join(shared, file), "utf8"))),
    ).toEqual(before);
  } finally {
    for (const directory of [runtime, shared])
      await rm(path.join(directory, "node_modules", fixture), { recursive: true, force: true });
    await rm(updated, { recursive: true, force: true });
  }
}, 30_000);

it("根脚本可调用 uv，子进程和 worker 作为标准 Node 运行", async () => {
  await writeFile(
    path.join(workspace, "work/descendant.mjs"),
    `import assert from 'node:assert/strict';
     import { uv } from ${JSON.stringify(pathToFileURL(path.join(runtime, "node_modules/@lg/uv/index.mjs")).href)};
     import { npm } from ${JSON.stringify(pathToFileURL(path.join(runtime, "node_modules/@lg/npm/index.mjs")).href)};
     import { inspectSources } from ${JSON.stringify(pathToFileURL(path.join(runtime, "node_modules/@lg/project/index.mjs")).href)};
     import { printPdf } from ${JSON.stringify(pathToFileURL(path.join(runtime, "node_modules/@lg/pdf/index.mjs")).href)};
     await assert.rejects(inspectSources([]), /not bound/);
     await assert.rejects(printPdf(''), /not bound/);
     await assert.rejects(uv.run(["--version"]), /not bound/);
     await assert.rejects(npm.run(["--version"]), /not bound/);
     console.log(typeof globalThis.ws);`,
  );
  const result = await run(`
    import { fork } from 'node:child_process';
    import { Worker } from 'node:worker_threads';
    import { once } from 'node:events';
    import { uv } from '@lg/uv';
    await uv.run(['--version']);
    await once(fork('work/descendant.mjs'), 'exit');
    await once(new Worker(new URL('../descendant.mjs', import.meta.url)), 'exit');
    console.log(typeof ws);
  `);
  expect(result.exitCode).toBe(0);
  expect(String(output_content(result.stdout)).trim().split(/\r?\n/u).sort()).toEqual([
    "object",
    "undefined",
    "undefined",
    expect.stringContaining(`uv ${app_package.workspaceRuntimeTools.uv}`),
  ]);
});

it("真实 uv 安装本地 wheel，搬移后恢复并取消后代", async () => {
  python_root = path.join(root, "managed Python");
  // 复用 uv 托管的解释器，搬移和取消使用独立副本。
  const uv = path.join(
    runtime,
    "bin",
    `${process.platform}-${process.arch}`,
    process.platform === "win32" ? "uv.exe" : "uv",
  );
  await promisify(execFile)(
    uv,
    ["--no-config", "python", "install", DEFAULT_PYTHON_VERSION, "--no-bin", "--no-registry"],
    { windowsHide: true, timeout: 180_000 },
  );
  const { stdout } = await promisify(execFile)(
    uv,
    ["--no-config", "python", "find", "--managed-python", "--no-project", DEFAULT_PYTHON_VERSION],
    { windowsHide: true, timeout: 30_000 },
  );
  const executable = await realpath(stdout.trim());
  const installation =
    process.platform === "win32"
      ? path.dirname(executable)
      : path.dirname(path.dirname(executable));
  await cp(installation, path.join(python_root, "interpreters", path.basename(installation)), {
    recursive: true,
  });
  const wheel = new JSZip();
  const metadata = "lg_python_fixture-1.0.0.dist-info";
  const files = {
    "lg_python_fixture.py": "value = '搭档的 Python'\n",
    [`${metadata}/METADATA`]: "Metadata-Version: 2.1\nName: lg-python-fixture\nVersion: 1.0.0\n",
    [`${metadata}/WHEEL`]:
      "Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
  };
  for (const [name, content] of Object.entries(files)) wheel.file(name, content);
  wheel.file(
    `${metadata}/RECORD`,
    [...Object.keys(files), `${metadata}/RECORD`].map((name) => `${name},,`).join("\n"),
  );
  const wheel_path = path.join(workspace, "work/lg_python_fixture-1.0.0-py3-none-any.whl");
  await writeFile(wheel_path, await wheel.generateAsync({ type: "nodebuffer" }));
  const initial = await run(
    `
    import { uv } from '@lg/uv';
    await uv.run(['add', ${JSON.stringify(wheel_path)}, '--offline']);
    await uv.run(['run', '--offline', 'python', '-c', "from pathlib import Path; import lg_python_fixture; Path('work/python-result.txt').write_text(lg_python_fixture.value, encoding='utf-8')"]);
    console.log('python ready');
  `,
    AbortSignal.timeout(30_000),
  );
  expect(output_content(initial.stdout)).toBe("python ready\n");
  expect(await readFile(path.join(workspace, "work/python-result.txt"), "utf8")).toBe(
    "搭档的 Python",
  );

  // 次版本链接与 venv 都记录绝对路径，搬移后由 uv 自行重建，应用不另做恢复。
  const moved = path.join(root, "移动后的 Python");
  await rename(python_root, moved);
  python_root = moved;
  const recovered = await run(
    `
    import { uv } from '@lg/uv';
    await uv.run(['run', '--offline', 'python', '-c', 'import lg_python_fixture; print(lg_python_fixture.value)']);
    await uv.run(['remove', 'lg-python-fixture', '--offline']);
  `,
    AbortSignal.timeout(30_000),
  );
  expect(String(output_content(recovered.stdout)).trim()).toBe("搭档的 Python");

  const pids_path = path.join(workspace, "work/python-pids.json");
  await writeFile(
    path.join(workspace, "work/python-wait.py"),
    `import subprocess,sys,os,json,time\nchild=subprocess.Popen([sys.executable,'-c','import time; time.sleep(300)'])\nopen('work/python-pids.json','w').write(json.dumps([os.getpid(),child.pid]))\ntime.sleep(300)\n`,
  );
  const controller = new AbortController();
  const stopped = new Error("stop uv SDK");
  const pending = run(
    `import {uv} from '@lg/uv'; await uv.run(['run', '--offline', 'python', 'work/python-wait.py']);`,
    controller.signal,
  ).catch((error: unknown) => error);
  try {
    let pids: number[] = [];
    await vi.waitFor(
      async () => {
        pids = JSON.parse(await readFile(pids_path, "utf8"));
        expect(pids).toHaveLength(2);
      },
      { timeout: 15_000 },
    );
    controller.abort(stopped);
    expect(await pending).toBe(stopped);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    controller.abort(stopped);
    await pending;
  }
}, 300_000);

/** 使用真实准备和 IPC 启动链，每次执行拥有独立脚本与日志。 */
async function run(
  script: string,
  signal: AbortSignal = AbortSignal.timeout(RUN_TIMEOUT_MS),
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
  tools: Pick<
    AgentWorkspaceRunRequest,
    | "printPDF"
    | "inspectSources"
    | "generateFiles"
    | "getOutputPaths"
    | "emitImage"
    | "doing"
    | "packageSource"
    | "search"
  > = {},
  directory = runtime,
) {
  const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/task-${++sequence}.mjs`;
  await writeFile(path.join(workspace, scriptPath), script);
  return await new AgentWorkspaceRunner({
    paths: skill_paths,
    execution: create_execution_runtime(directory, resolveProxy),
    proxyResolver: { resolveProxy },
  }).run(
    {
      workspacePath: workspace,
      scriptPath,
      stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stdout.log`,
      stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stderr.log`,
      timeoutMs: EXECUTION_TIMEOUT_MS,
      ...tools,
    },
    signal,
  );
}

/** 本场景期待额度内的完整输出。 */
function output_content(output: AgentProcessOutput) {
  if (!("content" in output)) throw new Error(output.message);
  return output.content;
}

/** 应用目录可切换，用户工程与跨进程锁保持一致。 */
function create_execution_runtime(
  directory = runtime,
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
) {
  const execution = new AgentExecutionRuntime({
    runtimeDirectory: directory,
    fontsDirectory: path.join(root, "fonts"),
    executablePath: electron_path,
    electronVersion: "45.0.0",
    paths: {
      get_agent_node_root_dir: () => path.join(root, "shared node"),
      get_agent_models_dir: () => path.join(root, "media storage/models"),
      get_agent_media_cache_dir: () => path.join(root, "cache/media"),
      get_agent_python_root_dir: () => python_root,
      get_agent_execution_lock_path: () => path.join(root, "node.lock"),
      get_user_data_path: (...parts) => path.join(root, "userdata", ...parts),
    },
    proxyResolver: { resolveProxy },
  });
  onTestFinished(() => execution.close()); // 测试超时也先回收进程和租约，再进入下一例。
  return execution;
}
