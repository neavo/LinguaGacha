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
    models: { vad: model, asr: model, det: model, rec: model },
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

it("deployed ASR worker decodes output and rejects nonfinite values", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "media ASR probe "));
  const ort = path.join(directory, "ort.mjs");
  const tokens = path.join(directory, "tokens.txt");
  await writeFile(tokens, "blank 0\nword 1\n");
  await writeFile(
    ort,
    `
    import assert from 'node:assert/strict';
    export class Tensor {
      constructor(type,data,dims) { this.data=data; this.dims=dims; }
      dispose() {}
    }
    export const InferenceSession = { async create(file, options) {
      assert.deepEqual(options.executionProviders, ['webgpu']);
      return { async run(feeds) {
        const logits = new Float32Array(10);
        if (feeds.speech.data[0] === -1) logits[0] = NaN;
        return {ctc_logits:new Tensor('float32',logits,[1,5,2]),
          encoder_out_lens:new Tensor('int32',Int32Array.of(5),[1])};
      }, async release() {} };
    }};
  `,
  );
  const model = {
    file: path.join(directory, "fixture.onnx"),
    device: "webgpu",
    threads: 4,
  } as const;
  const engine = new Engine(
    {
      ort: pathToFileURL(ort).href,
      tokens,
      models: { vad: model, asr: model, det: model, rec: model },
    },
    path.join(inject("workspaceRuntimeDirectory"), "runtime/media-worker.mjs"),
  );
  const request = (invalid = false) => {
    const input = new Float32Array(2 * 560);
    if (invalid) input[0] = -1;
    return engine.request(
      0,
      "asr",
      { dtype: "float32", shape: [1, 2, 560], language: "auto" },
      new Uint8Array(input.buffer),
    );
  };
  try {
    expect((await request()).header.tokens).toEqual([]);
    await expect(request(true)).rejects.toThrow("not finite");
  } finally {
    await engine.close();
  }
});

it("deployed OCR worker collapses CTC repeats, preserves blank-separated repeats and releases failed outputs", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "media OCR "));
  const ort = path.join(directory, "ort.mjs");
  await writeFile(
    ort,
    `
    const live = new Set();
    export class Tensor {
      constructor(type,data,dims) { this.data=data; this.dims=dims; live.add(this); }
      dispose() { if(!live.delete(this)) throw Error('double disposal'); }
    }
    export const InferenceSession = { async create() { return {
      inputNames:['image'], outputNames:['output'],
      async run(feeds) {
        const mode=feeds.image.data[0];
        if(mode===-3) throw Error('OCR execution failed');
        const ids=mode===1 ? [0,0,0,0,0,0] : [0,1,1,0,1,2];
        const data=new Float32Array(18);
        ids.forEach((id,i)=>data[i*3+id]=1);
        if(mode===-1) data[0]=NaN;
        return {output:new Tensor('float32',data,mode===-2 ? [2,3,3] : [1,6,3])};
      },
      async release() { if(live.size) throw Error('leaked tensors: '+live.size); }
    }} };
  `,
  );
  const model = { file: "fixture", device: "cpu", threads: 1 } as const;
  const engine = new Engine(
    {
      ort: pathToFileURL(ort).href,
      tokens: "unused",
      models: { vad: model, asr: model, det: model, rec: model },
    },
    path.join(inject("workspaceRuntimeDirectory"), "runtime/media-worker.mjs"),
  );
  const request = (mode = 0, height = 48) => {
    const input = new Float32Array(3 * height * 32);
    input[0] = mode;
    return engine.request(
      0,
      "rec",
      { dtype: "float32", shape: [1, 3, height, 32] },
      new Uint8Array(input.buffer),
    );
  };
  try {
    expect((await request()).header.tokens).toEqual([1, 1, 2]);
    expect((await request(1)).header.tokens).toEqual([]);
    await expect(request(-1)).rejects.toThrow("not finite");
    await expect(request(-2)).rejects.toThrow("Unexpected OCR output");
    await expect(request(-3)).rejects.toThrow("OCR execution failed");
    await expect(request(0, 32)).rejects.toThrow("Unexpected OCR input");
    expect((await request()).header.tokens).toEqual([1, 1, 2]);
  } finally {
    await engine.close();
  }
});
