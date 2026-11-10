import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, inject, it } from "vitest";
import { Engine } from "./inference-engine";
import type { MediaWorkerConfig } from "./worker-protocol";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("deployed VAD worker isolates streams and disposes tensors on replacement, release and errors", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "media deployment "));
  const ort = path.join(directory, "ort.mjs");
  await writeFile(
    ort,
    `const live = new Set();
export class Tensor {
  constructor(type, data, dims) { this.data=data; this.dims=dims; live.add(this); }
  dispose() { if(!live.delete(this)) throw Error('double disposal'); }
}
export const InferenceSession={ create:async()=>({
  inputNames:['speech',...Array.from({length:4},(_,i)=>'in_cache'+i)],
  outputNames:['logits',...Array.from({length:4},(_,i)=>'out_cache'+i)],
  async run(feeds) {
    const n=feeds.speech.dims[1], previous=feeds.in_cache0.data[0];
    if(feeds.speech.data[0]===-1) throw Error('fixture inference failure');
    const value=previous+1;
    return {logits:new Tensor('float32',new Float32Array(n*248).fill(value),[1,n,248]),
      ...Object.fromEntries(Array.from({length:4},(_,i)=>['out_cache'+i,new Tensor('float32',new Float32Array(128*19).fill(value),[1,128,19,1])]))};
  },
  async release() { if(live.size) throw Error('leaked tensors: '+live.size); }
})};`,
  );
  const model = { file: path.join(directory, "model.onnx"), device: "cpu", threads: 1 } as const;
  const config: MediaWorkerConfig = {
    ort: pathToFileURL(ort).href,
    tokens: "unused",
    models: { vad: model, asr: model, det: model },
  };
  const engine = new Engine(
    config,
    path.join(inject("workspaceRuntimeDirectory"), "runtime/media-worker.mjs"),
  );
  const request = async (stream: number, value = 0) => {
    const input = new Float32Array(800).fill(value);
    const result = await engine.request(
      stream,
      "vad",
      { dtype: "float32", shape: [1, 2, 400] },
      new Uint8Array(input.buffer),
    );
    expect(result.header.shape).toEqual([1, 2, 248]);
    return new Float32Array(result.payload!)[0];
  };
  try {
    expect(await request(0)).toBe(1);
    expect(await request(1)).toBe(1);
    expect(await request(0)).toBe(2);
    engine.release(0);
    engine.release(0);
    expect(await request(0)).toBe(1);
    await expect(request(0, -1)).rejects.toThrow("fixture inference failure");
    expect(await request(0)).toBe(1);
    await expect(
      engine.request(0, "vad", { dtype: "float32", shape: [1, 0, 400] }, new Uint8Array(0)),
    ).rejects.toThrow();
  } finally {
    await engine.close();
  }
});
