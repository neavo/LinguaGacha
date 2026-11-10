import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DeviceFailure, Engine } from "./inference-engine";
import type { MediaProfile, MediaTask, MediaWorkerConfig } from "./worker-protocol";

let directory: string;
const engines: Engine[] = [];
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "media engine "));
});
afterEach(async () => {
  await Promise.allSettled(engines.splice(0).map((engine) => engine.close()));
  await rm(directory, { recursive: true, force: true });
});
async function create(profile: MediaProfile): Promise<Engine> {
  const file = path.join(directory, "worker.mjs");
  await writeFile(
    file,
    `import { parentPort, threadId } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.type === 'close') return parentPort.close();
  if (m.type === 'release') return;
  parentPort.postMessage(m.header.fail
    ? { id:m.id, error:'model failed' }
    : { id:m.id, header:{ thread:threadId, id:m.id, kind:m.kind } });
});`,
  );
  const model = { file: "unused", device: "cpu", threads: 4 } as const;
  const config: MediaWorkerConfig = {
    ort: "unused",
    tokens: "unused",
    models: { vad: model, asr: model, det: model },
  };
  const engine = new Engine(profile, config, file);
  engines.push(engine);
  return engine;
}
const request = (engine: Engine, kind: MediaTask, fail = false) =>
  engine.request(0, kind, { fail }, new Uint8Array(0));

it("round-robins detection independently of interleaved audio requests", async () => {
  const engine = await create({ asr: "webgpu", det: "webgpu_dual" });
  const replies = await Promise.all(
    ["det", "vad", "det", "asr", "det", "asr", "det"].map((kind) =>
      request(engine, kind as MediaTask),
    ),
  );
  const threads = replies.map((reply) => reply.header.thread);
  expect(threads[0]).toBe(threads[4]);
  expect(threads[2]).toBe(threads[6]);
  expect(new Set(threads).size).toBe(4);
  expect(replies.map((reply) => reply.header.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  await engine.close();
});

it("attributes failures to the dispatched task and keeps VAD failures on CPU", async () => {
  const engine = await create({ asr: "webgpu", det: "webgpu_dual" });
  await expect(request(engine, "vad", true)).rejects.not.toBeInstanceOf(DeviceFailure);
  const error = await request(engine, "det", true).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(DeviceFailure);
  expect((error as DeviceFailure).task).toBe("det");
  await expect(request(engine, "asr")).rejects.toBe(error);
  await engine.close();
});
