import type { WorkspaceHostPort } from "./host-contract";
import type { AgentWorkspaceRunRequest } from "./runner";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AGENT_WORKSPACE_CONTRACT, AGENT_WORKSPACE_REFERENCES } from "../contract";
import { AgentWorkspaceRunner, AgentWorkspaceRunError, type AgentWorkspaceOutput } from "./runner";
import { AGENT_WORKSPACE_RUN_ROOT, AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import { create_pdf_fixture } from "../../../file/formats/pdf/test-support";
import { BackendResources } from "../../../bootstrap/backend-resources";
import { BackendServices } from "../../../bootstrap/backend-services";
import { AgentWorkspaceService } from "../service";
import { createPackage } from "@electron/asar";
import { resolve_workspace_runtime_entry } from "../../../../native/workspace-runtime";
import type { AgentWorkspaceRuntimeParentMessage } from "./protocol";
import { AGENT_IMAGE_MAX_EDGE } from "../../../../shared/agent-image";

const electron_path =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
const RUN_TIMEOUT_MS = 3_000; // 早于测试超时回收子进程，失败后目录清理也能完成
let root = "";
let runtime = "";
let workspace = "";
let sequence = 0;
const skill_paths = {
  get_agent_user_skill_dir: () => path.join(root, "user skills # %"),
  get_agent_builtin_skill_dir: () => path.join(root, "内置 skills"),
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "linguagacha-node-"));
  runtime = path.join(root, "runtime");
  workspace = path.join(root, "workspace");
  const deployed = process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME;
  if (deployed) await cp(deployed, runtime, { recursive: true });
  else
    execFileSync(process.execPath, [path.resolve("buildtools/build-workspace.mjs"), runtime], {
      windowsHide: true,
      stdio: "pipe",
    });
  await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
  await mkdir(path.join(workspace, "changes"));
  await cp(path.join(runtime, "package.json"), path.join(workspace, "package.json"));
  await symlink(
    path.join(runtime, "node_modules"),
    path.join(workspace, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(path.join(workspace, "contract.json"), JSON.stringify(AGENT_WORKSPACE_CONTRACT));
  for (const [relative_path, content] of Object.entries(AGENT_WORKSPACE_REFERENCES)) {
    await mkdir(path.dirname(path.join(workspace, relative_path)), { recursive: true });
    await writeFile(path.join(workspace, relative_path), content);
  }
  await writeFile(path.join(root, "outside.txt"), "outside");
}, 60_000);

afterAll(async () => {
  if (workspace)
    await unlink(path.join(workspace, "node_modules")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  if (root) await rm(root, { recursive: true, force: true });
});

it("上传原文件在真实工作区只读，可复制到 work 后修改", async () => {
  await mkdir(path.join(workspace, "uploads"), { recursive: true });
  await writeFile(path.join(workspace, "uploads/input.bin"), "original");
  const result = await run(`
    import { readFile, writeFile, copyFile } from 'node:fs/promises';
    const original = await readFile('uploads/input.bin', 'utf8');
    try { await writeFile('uploads/input.bin', 'changed'); throw new Error('write allowed'); }
    catch(error) { if(error.code !== 'ERR_ACCESS_DENIED') throw error; }
    await copyFile('uploads/input.bin', 'work/copy.bin');
    await writeFile('work/copy.bin', 'changed');
    console.log(JSON.stringify({original, copy: await readFile('work/copy.bin', 'utf8')}));
  `);
  expect(result.execution.exitCode).toBe(0);
  expect(await readFile(path.join(workspace, "uploads/input.bin"), "utf8")).toBe("original");
  expect(await readFile(path.join(workspace, "work/copy.bin"), "utf8")).toBe("changed");
});

it("独立部署目录支持原生模块、主程序身份、自然退出和异步 Todo", async () => {
  await mkdir(path.join(workspace, "work/scripts"));
  await writeFile(
    path.join(workspace, "work/scripts/helper.js"),
    "export const value = ws.todo.read()[0];",
  );
  await writeFile(path.join(workspace, "work/scripts/helper.cjs"), "module.exports = 42;");
  const result = await run(`
    import fs from 'node:fs/promises';
    import { fileURLToPath } from 'node:url';
    import value from '../scripts/helper.cjs';
    import { value as todo } from '../scripts/helper.js';
    await fs.writeFile('work/state.json', JSON.stringify(value));
    console.log(JSON.stringify({ main: fileURLToPath(import.meta.url) === process.argv[1], value, todo }));
    console.error('ordinary stderr');
    setTimeout(() => { console.log('async finished'); ws.todo.write(['核验结果']); }, 10);
    export default 1n;
  `);
  expect(result.execution).toMatchObject({
    exitCode: 0,
    signal: null,
    stderr: { content: "ordinary stderr\n" },
  });
  expect(output_content(result.execution.stdout)).toBe(
    '{"main":true,"value":42,"todo":"发现目标"}\nasync finished\n',
  );
  expect(result.todos).toEqual(["核验结果"]);
  expect(await readFile(path.join(workspace, result.execution.stdout.path), "utf8")).toBe(
    output_content(result.execution.stdout),
  );
  expect(
    (
      await run(
        "import fs from 'node:fs/promises'; console.log(await fs.readFile('work/state.json', 'utf8')); ",
      )
    ).execution.stdout,
  ).toMatchObject({ content: "42\n" });
  const empty = await run("// 没有输出的普通程序也成功");
  expect(empty.execution.exitCode).toBe(0);
  for (const output of [empty.execution.stdout, empty.execution.stderr]) {
    expect(output).toMatchObject({ bytes: 0, content: "" });
    expect(await readFile(path.join(workspace, output.path), "utf8")).toBe("");
  }
});

it("权限模式直接导入 MuPDF WASM 和 Markdown npm 包", async () => {
  await writeFile(path.join(workspace, "work/source.pdf"), create_pdf_fixture());
  const result = await run(`
    import { readFile } from 'node:fs/promises';
    import * as mupdf from 'mupdf';
    import {render_pdf_page} from '@lg/pdf';
    import { unified } from 'unified';
    import remarkParse from 'remark-parse';
    import remarkGfm from 'remark-gfm';
    const pdf = new mupdf.PDFDocument(new Uint8Array(await readFile('work/source.pdf')));
    try {
      const page = pdf.loadPage(0); const text = page.toStructuredText();
      try { console.log(JSON.stringify({ pages:pdf.countPages(), text:text.asText(), image:render_pdf_page(pdf,{page:3,scale:1}).length, markdown:unified().use(remarkParse).use(remarkGfm).parse('# Title').children[0].type })); }
      finally { text.destroy(); page.destroy(); }
    } finally { pdf.destroy(); }

  `);
  expect(result.execution.exitCode).toBe(0);
  expect(JSON.stringify(output_content(result.execution.stdout))).toContain("First half");
  expect(JSON.stringify(output_content(result.execution.stdout))).toContain("heading");
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
    import { build_pdf_document } from '@lg/pdf';
    import { readFile, writeFile } from 'node:fs/promises';
    import { title } from './helper.mjs';
    import { queryItemContexts } from '@lg/workspace/item-contexts';
    import { compile_literal_patterns } from '@lg/text';
    export async function inspect() {
      await writeFile('work/items.jsonl', JSON.stringify({item_id:1,file_path:'a',src:'Straße'}));
      const contexts = await queryItemContexts([JSON.parse(await readFile('work/items.jsonl', 'utf8'))], [1]);
      const matcher = compile_literal_patterns([{key:'street',text:'STRASSE',case_sensitive:false}]);
      if (contexts.items.length !== 1 || !matcher.matches(contexts.items[0].src)) throw new Error('Item contexts or text import failed');
      const bytes = await build_pdf_document({
        title, source_bytes: new Uint8Array(await readFile('work/source.pdf')),
        document:{digest:'a'.repeat(64),pages:[1,2,3].map(page=>({page,width:300,height:300,rotation:0,label:null,translation:page===2?{kind:'translate',markdown:'# fixture'}:null,reviewed:false,notes:''}))},
        print:async html => new Uint8Array(await readFile((await ws.host({kind:'print_pdf',html})).path)),
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
    import {writeFile} from 'node:fs/promises';
    const result = await inspect();
    if (${JSON.stringify(kind)} === 'user') {
      await writeFile(new URL(${JSON.stringify(entry_url)}), 'changed');
    } else {
      try { await writeFile(new URL(${JSON.stringify(entry_url)}), 'changed'); throw new Error('write allowed'); }
      catch(error) { if(error.code !== 'ERR_ACCESS_DENIED') throw error; }
    }
    console.log(JSON.stringify(result));
  `,
      undefined,
      undefined,
      async (request) => {
        expect(request.kind).toBe("print_pdf");
        expect(request.html).toContain("fixture");
        return { path: "work/printed.pdf" };
      },
    ).catch((error: unknown) => {
      if (error instanceof AgentWorkspaceRunError)
        throw new Error(JSON.stringify(error.execution), { cause: error });
      throw error;
    });
    expect(output_content(result.execution.stdout)).toEqual({
      type: "heading",
      path: "work/fixture.pdf",
    });
  },
);

it("用户技能目录链接可创建、替换和删除包，失败前的写入保留", async () => {
  const original = skill_paths.get_agent_user_skill_dir();
  const target = path.join(root, "linked-user-skills");
  await mkdir(target);
  const link = path.join(root, "user-skills-link");
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  skill_paths.get_agent_user_skill_dir = () => link;
  try {
    const result = await run(`
      import fs from 'node:fs/promises';
      import path from 'node:path';
      const staging = await fs.mkdtemp(path.join(ws.userSkillDirectory, '.install-'));
      await fs.writeFile(path.join(staging, 'SKILL.md'), 'first');
      const installed = path.join(ws.userSkillDirectory, 'fixture');
      await fs.rename(staging, installed);
      await fs.writeFile(path.join(installed, 'SKILL.md'), 'updated');
      const content = await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8');
      await fs.rm(installed, {recursive: true});
      await fs.writeFile(path.join(ws.userSkillDirectory, 'retained.txt'), content);
      process.exitCode = 1;
    `).catch((error: unknown) => {
      if (error instanceof AgentWorkspaceRunError) return { execution: error.execution };
      throw error;
    });
    expect(result.execution.exitCode).toBe(1);
    expect(await readFile(path.join(target, "retained.txt"), "utf8")).toBe("updated");
    await expect(readFile(path.join(target, "fixture/SKILL.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    skill_paths.get_agent_user_skill_dir = () => original;
    await unlink(link);
  }
});

it("发布态 ASAR 技能在原目录授权下导入脚本、资源和预装依赖", async () => {
  const directory = await mkdtemp(path.join(root, "asar-"));
  const source = path.join(directory, "source");
  const skill = path.join(source, "builtin/agent/skill/fixture");
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, "asset.txt"), "原包资源");
  await writeFile(path.join(skill, "helper.mjs"), "export const heading = '# fixture';");
  await writeFile(
    path.join(skill, "entry.mjs"),
    `
    import { readFile, writeFile } from 'node:fs/promises';
    import { unified } from 'unified';
    import remarkParse from 'remark-parse';
    import { heading } from './helper.mjs';
    const asset = new URL('./asset.txt', import.meta.url);
    let denied = false;
    try { await writeFile(asset, 'changed'); }
    catch(error) { if(error.code !== 'ERR_ACCESS_DENIED') throw error; denied = true; }
    console.log(JSON.stringify({
      text: await readFile(asset, 'utf8'), denied,
      type: unified().use(remarkParse).parse(heading).children[0].type,
      worker: import.meta.resolve('@lg/pdf/worker').endsWith('/worker.mjs'),
    }));
  `,
  );
  const archive = path.join(directory, "app.asar");
  await createPackage(source, archive);
  const skill_root = path.join(archive, "builtin/agent/skill");
  const start: AgentWorkspaceRuntimeParentMessage = {
    type: "start",
    userSkillDirectory: skill_paths.get_agent_user_skill_dir(),
    todos: [],
    skillRoots: [pathToFileURL(skill_root + path.sep).href],
  };
  // 普通 Node 测试宿主不识别 ASAR。由真实 Electron 加载生产 bootstrap，重放父进程初始化消息。
  const output = execFileSync(
    electron_path,
    [
      "--permission",
      `--allow-fs-read=${skill_root}`,
      `--allow-fs-read=${workspace}`,
      `--allow-fs-read=${runtime}`,
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      "--input-type=module",
      "-e",
      `
      setImmediate(() => process.emit('message', ${JSON.stringify(start)}));
      await import(${JSON.stringify(pathToFileURL(resolve_workspace_runtime_entry(runtime, "@lg/workspace/bootstrap")).href)});
      await import(${JSON.stringify(pathToFileURL(path.join(skill_root, "fixture/entry.mjs")).href)});
    `,
    ],
    {
      cwd: workspace,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
      windowsHide: true,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      stdio: "pipe",
    },
  );
  expect(JSON.parse(output)).toEqual({
    text: "原包资源",
    denied: true,
    type: "heading",
    worker: true,
  });
});

it("直接执行技能、apply、再次执行和重置均读取原包当前文件", async () => {
  const app_root = await mkdtemp(path.join(root, "lifecycle-"));
  await writeFile(path.join(app_root, "version.txt"), "0.0.0");
  const source = path.join(app_root, "source.txt");
  await writeFile(source, "Hello world.");
  const resources = await BackendResources.start({
    appRoot: app_root,
    builtinRoot: path.join(app_root, "builtin"),
    logTargets: { console: false, window: false },
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
  });
  const services = new BackendServices({
    paths: resources.paths,
    metadata: resources.metadata,
    appSettingService: resources.settings,
    database: resources.database,
    logManager: resources.logManager,
    publishEvent: () => {},
    openOutputFolder: async () => {},
    workerExecution: { kind: "in_process" },
  });
  try {
    await services.project.lifecycle.create_project_commit({
      path: path.join(app_root, "project.lg"),
      source_paths: [source],
      project_settings: { source_language: "EN", target_language: "ZH" },
    });
    const runner = new AgentWorkspaceRunner({
      paths: resources.paths,
      executablePath: electron_path,
      runtimeDirectory: runtime,
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
    });
    const service = new AgentWorkspaceService({
      images: {
        prepare: async () => {
          throw new Error("Unexpected image");
        },
      },
      paths: resources.paths,
      settings: resources.settings,
      sessionState: services.state.session,
      cache: services.state.cache,
      proofreading: services.proofreading.query,
      database: resources.database,
      runtimeGate: { run_agent_project_write: async (operation) => operation() },
      writeStore: services.state.writes,
      logManager: resources.logManager,
      run: runner.run.bind(runner),
      runtimeDirectory: runtime,
      openDirectory: async () => {},
      pickSavePath: async () => null,
    });
    await service.initialize();
    // 两个空根先运行一次，后续新增文件在下一 run 自然可读。
    await service.run("console.log('ready');", [], AbortSignal.timeout(RUN_TIMEOUT_MS));
    const entry = path.join(resources.paths.get_agent_user_skill_dir(), "fixture", "entry.mjs");
    await mkdir(path.dirname(entry), { recursive: true });
    // 原包替换正文，下一进程必须看到新版本；apply 使用真实工程写入口。
    const module_body = (value: string) => `
      import { readFile, writeFile } from 'node:fs/promises';
      export async function update() {
        const row = JSON.parse((await readFile(ws.contract.datasets.items.path, 'utf8')).trim().split('\\n')[0]);
        const reference = await readFile(ws.contract.changes.items.updates.reference, 'utf8');
        if (!reference.includes(ws.contract.changes.items.updates.path)) throw new Error('Missing update reference');
        const dst = ${JSON.stringify(value)};
        await writeFile(ws.contract.changes.items.updates.path, JSON.stringify({item_id:row.item_id,fp:row.fp,dst}));
        console.log(JSON.stringify({before:row.dst,after:dst}));
      }
    `;
    await writeFile(entry, module_body("第一版"));
    const script = `const {update} = await import(${JSON.stringify(pathToFileURL(entry).href)}); await update();`;
    await service.run(script, [], AbortSignal.timeout(RUN_TIMEOUT_MS));
    expect(await service.apply_workspace(async () => {})).toMatchObject({ status: "applied" });
    expect(services.state.cache.items.readItems()[0]?.dst).toBe("第一版");
    await writeFile(entry, module_body("第二版"));
    const result = await service.run(script, [], AbortSignal.timeout(RUN_TIMEOUT_MS));
    expect(result.execution.stdout).toMatchObject({
      content: { before: "第一版", after: "第二版" },
    });
    await service.reset_workspace();
    expect(
      (await service.run(script, [], AbortSignal.timeout(RUN_TIMEOUT_MS))).execution.stdout,
    ).toMatchObject({ content: { before: "第一版", after: "第二版" } });
    await unlink(entry);
    await expect(service.run(script, [], AbortSignal.timeout(RUN_TIMEOUT_MS))).rejects.toThrow();
  } finally {
    await services.dispose();
    await resources.dispose();
  }
});

it("超额输出完整落盘，主动错误输出与未捕获异常都保留", async () => {
  const limit = AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes;
  let error: unknown;
  try {
    await run(`
      process.stdout.write('x'.repeat(${limit}) + 'END');
      process.stderr.write('y'.repeat(${limit}));
      console.error('manual error');
      throw new Error('automatic error');
    `);
  } catch (cause) {
    error = cause;
  }
  if (!(error instanceof AgentWorkspaceRunError))
    throw error ?? new Error("Expected program failure");
  expect(error.execution.exitCode).toBe(1);
  for (const output of [error.execution.stdout, error.execution.stderr]) {
    expect(output.bytes).toBeGreaterThan(limit);
    expect(output).not.toHaveProperty("content");
    expect(output).toHaveProperty("message");
  }
  const stdout = await readFile(path.join(workspace, error.execution.stdout.path), "utf8");
  const stderr = await readFile(path.join(workspace, error.execution.stderr.path), "utf8");
  expect(stdout.length).toBe(limit + 3);
  expect(stdout.endsWith("END")).toBe(true);
  expect(stderr).toContain("manual error");
  expect(stderr).toContain("Error: automatic error");
});

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
    expect(output_content(result.execution.stdout)).toEqual({
      text: '<article><h1>Hello</h1><p><a href="/target">世界</a></p></article>',
      html: '<article><h1>Hello</h1><p><a href="/target">世界</a></p></article>',
      url: `http://127.0.0.1:${address.port}/page`,
    });
    // 先收到代理请求，再返回错误；等待宿主期间 IPC 必须维持子进程存活。
    let release!: (rules: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const proxy = new Promise<string>((resolve) => {
      release = resolve;
    });
    const pending = run(
      "try { await fetch('https://example.invalid'); } catch (error) { console.log(error.message); }",
      undefined,
      async () => {
        started();
        return await proxy;
      },
    );
    await ready;
    release("UNSUPPORTED");
    expect(output_content((await pending).execution.stdout)).toContain(
      "System proxy returned no supported route",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("权限保护部署与快照，失败保留输出、位置和已写文件", async () => {
  const result = await run(`
    import fs from 'node:fs/promises';
    const failures = [];
    for (const operation of [
      () => fs.readFile('../outside.txt'),
      () => fs.writeFile('contract.json', '{}'),
      () => fs.writeFile(ws.contract.datasets.items.reference, 'changed'),
      () => fs.writeFile('package.json', '{}'),
      () => fs.writeFile('node_modules/unified/package.json', '{}'),
    ]) { try { await operation(); } catch (error) { failures.push(error.code); } }
    console.log(JSON.stringify(failures));
  `);
  expect(output_content(result.execution.stdout)).toEqual(Array(5).fill("ERR_ACCESS_DENIED"));
  await expect(
    run(
      `import fs from 'node:fs/promises'; await fs.writeFile('work/kept.txt','kept'); console.log('before error'); throw new Error('program failed');`,
    ),
  ).rejects.toMatchObject({
    execution: {
      exitCode: 1,
      stdout: { content: "before error\n" },
      stderr: { content: expect.stringContaining("program failed") },
    },
  });
  expect(await readFile(path.join(workspace, "work/kept.txt"), "utf8")).toBe("kept");
  await expect(
    run('console.error(JSON.stringify({ message: "intentional exit" })); process.exitCode = 7;'),
  ).rejects.toMatchObject({
    execution: { exitCode: 7, stderr: { content: { message: "intentional exit" } } },
  });
  expect((await run("process.exit(0);")).execution.exitCode).toBe(0);
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

it.each([false, true])(
  "工作区祖先、部署目录及可写挂载支持链接（work 本身链接：%s）",
  async (mount_work) => {
    const directory = await mkdtemp(path.join(root, "linked-"));
    const data = path.join(directory, "data");
    const data_link = path.join(directory, "data-link");
    const runtime_link = path.join(directory, "runtime-link");
    const actual_workspace = path.join(data, "agent", "workspace");
    const logical_workspace = path.join(data_link, "agent", "workspace");
    const external = path.join(directory, "external");
    const link_type = process.platform === "win32" ? "junction" : "dir";
    await mkdir(actual_workspace, { recursive: true });
    await mkdir(external);
    await symlink(data, data_link, link_type);
    await symlink(runtime, runtime_link, link_type);
    try {
      if (mount_work) await symlink(external, path.join(logical_workspace, "work"), link_type);
      else await mkdir(path.join(logical_workspace, "work"));
      await mkdir(path.join(logical_workspace, "changes"));
      await symlink(
        path.join(runtime, "node_modules"),
        path.join(logical_workspace, "node_modules"),
        link_type,
      );
      await symlink(external, path.join(logical_workspace, "work", "output"), link_type);
      await writeFile(path.join(external, "helper.mjs"), "export const title = 'linked';");
      await writeFile(
        path.join(logical_workspace, "contract.json"),
        JSON.stringify(AGENT_WORKSPACE_CONTRACT),
      );
      await cp(path.join(runtime, "package.json"), path.join(logical_workspace, "package.json"));
      await mkdir(path.join(logical_workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
      const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/task.mjs`;
      await writeFile(
        path.join(logical_workspace, scriptPath),
        `
      import fs from 'node:fs/promises';
      import { unified } from 'unified';
      import remarkParse from 'remark-parse';
      import { title } from '../output/helper.mjs';
      const text = unified().use(remarkParse).parse('# ' + title).children[0].children[0].value;
      await fs.writeFile('work/output/result.md', text);
      await fs.writeFile('changes/result.json', JSON.stringify({title}));
      console.log(await fs.readFile('work/output/result.md', 'utf8'));
    `,
      );
      const result = await new AgentWorkspaceRunner({
        paths: skill_paths,
        executablePath: electron_path,
        runtimeDirectory: runtime_link,
        systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      }).run(
        {
          workspacePath: logical_workspace,
          scriptPath,
          stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/task.stdout.log`,
          stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/task.stderr.log`,
          todos: [],
        },
        AbortSignal.timeout(RUN_TIMEOUT_MS),
      );
      expect(result.execution.exitCode).toBe(0);
      expect(output_content(result.execution.stdout)).toMatch(/^linked\s*$/u);
      expect(await readFile(path.join(external, "result.md"), "utf8")).toBe("linked");
      expect(
        JSON.parse(await readFile(path.join(actual_workspace, "changes/result.json"), "utf8")),
      ).toEqual({ title: "linked" });
    } finally {
      await unlink(data_link);
      await unlink(runtime_link);
    }
  },
);

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
    undefined,
    async (path, _signal, options) => {
      if (path === "invalid") throw new Error("image rejected");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      paths.push(path);
      edges.push(options?.maxEdge);
    },
  );
  expect(paths).toEqual(["work/第一页.webp", "work/第二页.webp"]);
  expect(edges).toEqual([undefined, AGENT_IMAGE_MAX_EDGE]);
  expect(output_content(result.execution.stdout)).toContain("image rejected");
});

it("页面更新模块在部署工作区解析记录并判定目标", async () => {
  const result = await run(`
    import { parse_page_update, resolve_agent_workspace_page_updates } from '@lg/workspace/page-updates';
    const value = {file_path:'sample.pdf',page:1,fp:'abcd',translation:null,reviewed:false,notes:''};
    const valid = parse_page_update({line:2,value});
    const missing = resolve_agent_workspace_page_updates([valid.intent], []);
    console.log(JSON.stringify(missing.rejected));
  `);
  expect(output_content(result.execution.stdout)).toMatchObject([
    { reason: "target_missing", line: 2 },
  ]);
});

it("工作区预装表格、ZIP 和编码库在权限模式下读写并自然退出", async () => {
  const result = await run(
    `
    import assert from 'node:assert/strict';
    import ExcelJS from 'exceljs';
    import JSZip from 'jszip';
    import iconv from 'iconv-lite';
    import {detect} from 'chardet';
    const workbook=new ExcelJS.Workbook();
    const sheet=workbook.addWorksheet('Sheet1');
    sheet.getCell('A1').value='原文 🌸';
    const read=new ExcelJS.Workbook();
    await read.xlsx.load(await workbook.xlsx.writeBuffer());
    assert.equal(read.getWorksheet('Sheet1').getCell('A1').value,'原文 🌸');
    const zip=new JSZip();
    zip.file('中文.txt','你好');
    const archive=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));
    assert.equal(await archive.file('中文.txt').async('string'),'你好');
    assert.equal(iconv.decode(iconv.encode('中文','gbk'),'gbk'),'中文');
    assert.equal(typeof detect(Buffer.from('sample')),'string');
    console.log('file libraries ready');
  `,
    AbortSignal.timeout(10000),
  );
  expect(result.execution.exitCode).toBe(0);
  expect(output_content(result.execution.stdout)).toBe("file libraries ready\n");
});

/** 保存真实 ESM 文件并通过生产 runner 观察进程结果。 */
async function run(
  script: string,
  signal: AbortSignal = AbortSignal.timeout(RUN_TIMEOUT_MS),
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
  host?: WorkspaceHostPort,
  emitImage?: AgentWorkspaceRunRequest["emitImage"],
) {
  const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/task-${++sequence}.mjs`;
  await writeFile(path.join(workspace, scriptPath), script);
  return await new AgentWorkspaceRunner({
    paths: skill_paths,
    executablePath: electron_path,
    runtimeDirectory: runtime,
    systemProxyResolver: { resolveProxy },
  }).run(
    {
      workspacePath: workspace,
      scriptPath,
      stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stdout.log`,
      stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stderr.log`,
      todos: ["发现目标"],
      host,
      emitImage,
    },
    signal,
  );
}

/** 本场景期待额度内的完整输出。 */
function output_content(output: AgentWorkspaceOutput) {
  if (!("content" in output)) throw new Error(output.message);
  return output.content;
}
