import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setTimeout } from "node:timers/promises";
import { beforeAll, afterAll, expect, it } from "vitest";
import { RPGMakerMvMzPrepareWorker } from "./prepare-worker";
import { build_worker_threads_backend_worker_execution_from_desktop_bundle_dir } from "../../worker/worker-execution";
import { evb_fixture } from "../../../test/evb-fixture";

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
  const worker = new RPGMakerMvMzPrepareWorker(execution.rpgmakerMvMzPrepareWorkerEntryUrl);
  const task = {
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
