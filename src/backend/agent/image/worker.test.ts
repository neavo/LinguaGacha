import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, inject, it } from "vitest";
import { InferenceClient } from "../inference/client";
import type { ImageWorkerConfig } from "./engine";

it("部署后的单图片 Worker 按需复用气泡与文字会话，并在失败后释放原生资源", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-worker-"));
  try {
    const module = path.join(directory, "ort.mjs");
    const dictionary = path.join(directory, "dictionary.txt");
    await fs.writeFile(dictionary, "あ\n");
    await fs.writeFile(
      module,
      `
      const live=new Set();const created=new Set();
      process.on("exit",()=>{if(created.size)throw Error("unreleased sessions")});
      export class Tensor {
        constructor(type,data,dims){this.data=data;this.dims=dims;live.add(this)}
        dispose(){if(!live.delete(this))throw Error('double disposal')}
      }
      export const InferenceSession={create:async (kind, options)=>{if(options.executionProviders[0]==='webgpu')throw Error('fixture backend unavailable');if(created.has(kind))throw Error('session recreated');created.add(kind);return ({
        inputNames:['images'], outputNames:['output0','output1'],
        async run(feeds){
          const value=Object.values(feeds)[0].data[0];
          if(value<0)throw Error('fixture inference failure');
          if(kind==='inpaint')return {output0:new Tensor('float32',new Float32Array(3*64*64).fill(value===.5?NaN:.25),value===.75?[1,3,32,32]:[1,3,64,64])};
          if(kind==='detection')return {output0:new Tensor('float32',new Float32Array(32*32).fill(.5),[1,1,32,32])};
          if(kind==='recognition')return {output0:new Tensor('float32',new Float32Array([0,1,0,1,0,0]),[1,2,3])};
          const channels=value===2?39:37;
          return {output0:new Tensor('float32',new Float32Array(channels*21).fill(value===3?NaN:1),[1,channels,21]),output1:new Tensor('float32',new Float32Array(32*8*8).fill(2),[1,32,8,8])};
        },
        async release(){if(live.size)throw Error('unreleased tensors');created.delete(kind)}
      })}};
    `,
    );
    const client = new InferenceClient(
      {
        ort: pathToFileURL(module).href,
        device: "cpu",
        models: {
          bubble: "bubble",
          detection: "detection",
          recognition: "recognition",
          inpaint: "inpaint",
        },
        dictionary,
      } satisfies ImageWorkerConfig,
      path.join(inject("workspaceRuntimeDirectory"), "runtime/image-worker.mjs"),
    );
    const request = (value: number, kind = "bubble") =>
      client.request(
        "image",
        { kind },
        { dtype: "float32", shape: [1, 3, 32, 32] },
        new Uint8Array(new Float32Array(3 * 32 * 32).fill(value).buffer),
      );
    try {
      await expect(request(-1)).rejects.toThrow("fixture inference failure");
      await expect(request(2)).rejects.toThrow("output shape");
      await expect(request(3)).rejects.toThrow("not finite");
      for (let i = 0; i < 2; i++) {
        const reply = await request(1);
        expect(reply.header.shapes).toEqual([
          [1, 37, 21],
          [1, 32, 8, 8],
        ]);
        expect(new Float32Array(reply.payload!).length).toBe(37 * 21 + 32 * 8 * 8);
      }
      for (let i = 0; i < 2; i++) {
        const reply = await request(1, "detection");
        expect(reply.header.shapes).toEqual([[32, 32]]);
        expect(new Float32Array(reply.payload!)).toEqual(new Float32Array(32 * 32).fill(0.5));
      }
      const recognition = await client.request(
        "image",
        { kind: "recognition" },
        { dtype: "float32", shape: [1, 3, 48, 16] },
        new Uint8Array(new Float32Array(3 * 48 * 16).buffer),
      );
      expect(recognition.header).toEqual({ text: "あ" });
      const repair = (value: number) => {
        const input = new Float32Array(4 * 64 * 64).fill(value);
        input.fill(1, 3 * 64 * 64);
        return client.request(
          "image",
          { kind: "inpaint" },
          { dtype: "float32", shape: [1, 4, 64, 64] },
          new Uint8Array(input.buffer),
        );
      };
      for (let i = 0; i < 2; i++) {
        const result = await repair(0.25);
        expect(result.header.shapes).toEqual([[1, 3, 64, 64]]);
        expect(new Float32Array(result.payload!)).toEqual(new Float32Array(3 * 64 * 64).fill(0.25));
      }
      await expect(repair(0.5)).rejects.toThrow("not finite");
      await expect(repair(0.75)).rejects.toThrow("output shape");
    } finally {
      await client.close();
    }
    const unavailable = new InferenceClient(
      {
        ort: pathToFileURL(module).href,
        device: "webgpu",
        models: {
          bubble: "bubble",
          detection: "detection",
          recognition: "recognition",
          inpaint: "inpaint",
        },
        dictionary,
      } satisfies ImageWorkerConfig,
      path.join(inject("workspaceRuntimeDirectory"), "runtime/image-worker.mjs"),
    );
    try {
      await expect(
        unavailable.request(
          "gpu",
          { kind: "bubble" },
          { dtype: "float32", shape: [1, 3, 32, 32] },
          new Uint8Array(3 * 32 * 32 * 4),
        ),
      ).rejects.toThrow("fixture backend unavailable");
    } finally {
      await unavailable.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
