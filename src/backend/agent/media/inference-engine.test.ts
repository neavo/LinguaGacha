import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DeviceFailure } from "../inference/client";
import { Engine } from "./inference-engine";
import type { MediaTask, MediaWorkerConfig } from "./worker-protocol";

let directory: string;
const engines: Engine[] = [];
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "media engine "));
});
afterEach(async () => {
  await Promise.allSettled(engines.splice(0).map((engine) => engine.close()));
  await rm(directory, { recursive: true, force: true });
});
/** 使用回显 Worker 观察实际路由和故障归属。 */
async function create(device: "cpu" | "webgpu" = "webgpu"): Promise<Engine> {
  const file = path.join(directory, "worker.mjs");
  await writeFile(
    file,
    `import { parentPort, threadId } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.type === 'close') return parentPort.close();
  parentPort.postMessage(m.header.fail
    ? { id:m.id, error:'model failed' }
    : { id:m.id, header:{ thread:threadId, id:m.id, kind:m.kind } });
});`,
  );
  const model = { file: "unused", device: "cpu", threads: 4 } as const;
  const config: MediaWorkerConfig = {
    ort: "unused",
    tokens: "unused",
    models: {
      vad: model,
      asr: { ...model, device },
      detection: { ...model, device },
      recognition: { ...model, device },
    },
  };
  const engine = new Engine(config, file);
  engines.push(engine);
  return engine;
}
const request = (engine: Engine, kind: MediaTask, fail = false) =>
  engine.request(kind, { fail }, new Uint8Array(0));

it("shares two CPU visual workers for detection and OCR independently of audio", async () => {
  const engine = await create("cpu");
  const replies = await Promise.all(
    ["detection", "vad", "recognition", "asr", "recognition", "asr", "detection"].map((kind) =>
      request(engine, kind as MediaTask),
    ),
  );
  const threads = replies.map((reply) => reply.header.thread);
  expect(threads[0]).toBe(threads[4]);
  expect(threads[2]).toBe(threads[6]);
  expect(threads[0]).not.toBe(threads[2]);
  expect(new Set(threads).size).toBe(3);
  await engine.close();
});

it("shares one GPU worker for ASR, detection and OCR while VAD stays on CPU", async () => {
  const engine = await create();
  const replies = await Promise.all(
    ["asr", "detection", "recognition", "vad"].map((kind) => request(engine, kind as MediaTask)),
  );
  const threads = replies.map((reply) => reply.header.thread);
  expect(threads[0]).toBe(threads[1]);
  expect(threads[0]).toBe(threads[2]);
  expect(threads[0]).not.toBe(threads[3]);
});

it("marks GPU failures for rerun and keeps VAD errors on CPU", async () => {
  const engine = await create();
  await expect(request(engine, "vad", true)).rejects.not.toBeInstanceOf(DeviceFailure);
  const error = await request(engine, "detection", true).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(DeviceFailure);
  await expect(request(engine, "asr")).rejects.toBe(error);
  await engine.close();
});
