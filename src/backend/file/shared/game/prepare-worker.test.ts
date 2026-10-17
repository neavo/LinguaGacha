import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setTimeout } from "node:timers/promises";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { GamePrepareWorker } from "./prepare-worker";
import { build_worker_threads_backend_worker_execution_from_desktop_bundle_dir } from "../../../worker/worker-execution";
import { evb_fixture } from "../../../../test/evb-fixture";
import { wolf_files } from "../../../../test/wolf-fixture";
import { wolf_archive_fixture } from "../../../../test/wolf-archive-fixture";
import { rgss_archive_fixture } from "../../../../test/rgss-archive-fixture";
import { NativeFs } from "../../../../native/native-fs";

let runtime: string;
beforeAll(() => {
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), "lg-game-runtime-"));
  execFileSync(
    process.execPath,
    [
      "node_modules/electron-vite/bin/electron-vite.js",
      "build",
      "--config",
      "buildtools/vite/electron.vite.config.ts",
      "--outDir",
      runtime,
    ],
    {
      windowsHide: true,
      stdio: "pipe",
    },
  );
  fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({ type: "module" }));
}, 60000);
afterAll(async () => {
  await fs.promises.rm(runtime, { recursive: true, force: true });
});

it("发行线程完成暂存后退出，取消也等到句柄释放，随后仍可准备", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-worker-"));
  const executable = path.join(temp.path, "Game.exe"),
    staging = path.join(temp.path, "stage");
  fs.mkdirSync(staging);
  fs.writeFileSync(
    executable,
    evb_fixture(
      new Map([
        ["large.bin", Buffer.alloc(32 * 1024 * 1024, 42)],
        ["data/System.json", Buffer.from("{}")],
        ["js/rmmz_core.js", Buffer.from("// fixture")],
      ]),
    ),
  );
  const execution = build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(
    path.join(runtime, "main"),
  );
  if (execution.kind !== "worker_threads") throw new Error("Expected worker execution");
  const worker = new GamePrepareWorker(execution.gamePrepareWorkerEntryUrl);
  const task = {
    kind: "mv_mz" as const,
    game: {
      root: temp.path,
      data_root: temp.path,
      executable,
      engine: "mz" as const,
    },
    staging,
  };
  try {
    const controller = new AbortController();
    const pending = worker.run(task, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(path.join(staging, "large.bin"))) {
      if (Date.now() > deadline) throw new Error("Worker did not begin extraction");
      await setTimeout(1);
    }
    controller.abort();
    await rejected;
    fs.rmSync(staging, { recursive: true }); // Windows 文件句柄仍占用时，此处会失败。
    fs.mkdirSync(staging);
    const result = await worker.run(task);
    expect(result.writes).toContain("Game.exe");
    expect(fs.statSync(path.join(staging, "large.bin")).size).toBe(32 * 1024 * 1024);
    expect(fs.readFileSync(path.join(staging, "Game.exe")).length).toBe(1024);
    expect(fs.readdirSync(temp.path).sort()).toEqual(["Game.exe", "stage"]);
  } finally {
    await worker.dispose();
  }
  await expect(worker.run(task)).rejects.toThrow();
}, 30000);

it.each(["rgss", "wolfrpg"] as const)(
  "%s 使用共用线程暂存，关闭等待取消完成且来源保持原样",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-worker-"));
    const staging = path.join(temp.path, "stage");
    fs.mkdirSync(staging);
    const wolf = new Map([
      ["large.bin", Buffer.alloc(8 * 1024 * 1024, 42)],
      ...[...wolf_files()].map(([name, bytes]): [string, Buffer] => [name.slice(5), bytes]),
    ]);
    const archive = kind === "wolfrpg" ? "Data.wolf" : "Game.rgss3a";
    const bytes =
      kind === "wolfrpg"
        ? await wolf_archive_fixture(wolf, 100, { empty_directory: true })
        : rgss_archive_fixture(3, new Map([["large.bin", Buffer.alloc(8 * 1024 * 1024, 42)]]));
    fs.writeFileSync(path.join(temp.path, archive), bytes);
    const task =
      kind === "wolfrpg"
        ? {
            kind,
            staging,
            game: {
              root: temp.path,
              data_root: path.join(temp.path, "Data"),
              key_files: [],
              archives: [{ source_path: path.join(temp.path, archive), output_prefix: "Data" }],
            },
          }
        : { kind, staging, game: { root: temp.path, version: "ace" as const, archive } };
    const worker = new GamePrepareWorker(
      pathToFileURL(path.join(runtime, "main/game-prepare-worker-entry.js")),
    );
    const pending = worker.run(task);
    const rejected = expect(pending).rejects.toThrow();
    const active_file = path.join(staging, kind === "wolfrpg" ? "Data/large.bin" : "large.bin");
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(active_file)) {
      if (Date.now() > deadline) throw new Error("Worker did not begin extraction");
      await setTimeout(1);
    }
    await worker.dispose();
    await rejected;
    fs.rmSync(staging, { recursive: true });
    fs.mkdirSync(staging);
    const next = new GamePrepareWorker(
      pathToFileURL(path.join(runtime, "main/game-prepare-worker-entry.js")),
    );
    try {
      const result = await next.run(task);
      expect(result.removes).toEqual([archive]);
      if (kind === "wolfrpg") {
        expect(result.directories).toEqual(
          expect.arrayContaining(["Data", "Data/Empty", "Data/BasicData", "Data/MapData"]),
        );
        expect(fs.existsSync(path.join(staging, "Data/Empty"))).toBe(false);
      }
    } finally {
      await next.dispose();
    }
    expect(fs.readFileSync(path.join(temp.path, archive))).toEqual(bytes);
    fs.rmSync(staging, { recursive: true });
  },
  30000,
);

it("同进程入口保留显式注入的 NativeFs", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-in-process-"));
  const native = new NativeFs(),
    root = path.join(temp.path, "game");
  native.write_file_sync(path.join(root, "data/System.json"), "{}");
  native.write_file_sync(path.join(root, "js/rmmz_core.js"), "");
  vi.spyOn(native, "read_file").mockImplementation(() => {
    throw new Error("injected filesystem");
  });
  const worker = new GamePrepareWorker(null, native);
  try {
    await expect(
      worker.run({
        kind: "mv_mz",
        game: { root, data_root: root, engine: "mz" },
        staging: temp.path,
      }),
    ).rejects.toThrow("injected filesystem");
  } finally {
    await worker.dispose();
  }
});

it("仓库外真实 Electron 加载部署准备线程并等待退出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-electron-"));
  const entry = path.join(temp.path, "entry.ts"),
    staging = path.join(temp.path, "stage");
  fs.mkdirSync(staging);
  const archive = await wolf_archive_fixture(
    new Map([
      ["large.bin", Buffer.alloc(8 * 1024 * 1024, 42)],
      ...[...wolf_files()].map(([name, bytes]): [string, Buffer] => [name.slice(5), bytes]),
    ]),
    100,
    { empty_directory: true },
  );
  fs.writeFileSync(path.join(temp.path, "Data.wolf"), archive);
  fs.writeFileSync(
    entry,
    `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    import { setTimeout } from 'node:timers/promises';
    import { GamePrepareWorker } from ${JSON.stringify(pathToFileURL(path.resolve("src/backend/file/shared/game/prepare-worker.ts")).href)};
    const root=process.cwd();
    const worker=new GamePrepareWorker(pathToFileURL(process.argv[2]));
    const task={kind:'wolfrpg',staging:path.join(root,'stage'),game:{root,data_root:path.join(root,'Data'),key_files:[],archives:[{source_path:path.join(root,'Data.wolf'),output_prefix:'Data'}]}};
    const pending=worker.run(task); const rejected=assert.rejects(pending);
    const deadline=Date.now()+10000;
    while(!fs.existsSync(path.join(task.staging,'Data/large.bin'))) { if(Date.now()>deadline) throw new Error('Worker did not begin extraction'); await setTimeout(1); }
    await worker.dispose(); await rejected;
    fs.rmSync(task.staging,{recursive:true}); fs.mkdirSync(task.staging);
    const next=new GamePrepareWorker(pathToFileURL(process.argv[2]));
    try { const result=await next.run(task); assert(result.writes.includes('Data/BasicData/Game.dat')); assert.deepEqual(result.removes,['Data.wolf']); assert(result.directories.includes('Data/Empty')); assert(!fs.existsSync(path.join(task.staging,'Data/Empty'))); }
    finally { await next.dispose(); }
    fs.rmSync(task.staging,{recursive:true});
    console.log('game-worker-deployment-ok');
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
  const electron =
    process.env["LINGUAGACHA_TEST_ELECTRON"] ??
    (createRequire(import.meta.url)("electron") as string);
  const worker_entry =
    process.env["LINGUAGACHA_TEST_GAME_WORKER"] ??
    path.join(runtime, "main/game-prepare-worker-entry.js");
  const result = await promisify(execFile)(
    electron,
    [path.join(temp.path, "bundle/smoke.mjs"), worker_entry],
    {
      cwd: temp.path,
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  expect(result.stdout).toContain("game-worker-deployment-ok");
}, 60000);
