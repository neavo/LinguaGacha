import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, inject, it } from "vitest";
import { run_calibration } from "./calibration";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("deployed calibration runs one 20-second input per device without a warmup", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "media calibration deployment "));
  const ort = path.join(directory, "ort.mjs");
  const calls = path.join(directory, "calls.jsonl");
  const tokens = path.join(directory, "tokens.txt");
  await writeFile(tokens, "blank 0\nword 1\n");
  await writeFile(
    ort,
    `
    import { appendFileSync } from 'node:fs';
    export class Tensor {
      constructor(type,data,dims) { this.data=data; this.dims=dims; }
      dispose() {}
    }
    // 独立 Worker 内用逻辑时钟区分初始化和推理，避免依赖机器负载。
    let clock = 0;
    Object.defineProperty(performance, 'now', {value:()=>clock});
    export const InferenceSession = { async create(file, options) {
      clock += 1000;
      return { async run(feeds) {
        clock += 10;
        appendFileSync(${JSON.stringify(calls)}, JSON.stringify({device:options.executionProviders[0],shape:feeds.speech.dims})+'\\n');
        return {ctc_logits:new Tensor('float32',new Float32Array(10),[1,5,2]),
          encoder_out_lens:new Tensor('int32',Int32Array.of(5),[1])};
      }, async release() {} };
    }};
  `,
  );
  const runtime = path.join(inject("workspaceRuntimeDirectory"), "runtime");
  for (const device of ["cpu", "webgpu"] as const) {
    const model = { file: path.join(directory, "fixture.onnx"), device, threads: 1 };
    const result = await run_calibration(path.join(runtime, "media-calibrate.mjs"), {
      worker: path.join(runtime, "media-worker.mjs"),
      config: {
        ort: pathToFileURL(ort).href,
        tokens,
        models: { vad: model, asr: model, det: model },
      },
    });
    expect(result.inference).toBe(10);
  }
  expect(
    (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { device: "cpu", shape: [1, 333, 560] },
    { device: "webgpu", shape: [1, 333, 560] },
  ]);
});
