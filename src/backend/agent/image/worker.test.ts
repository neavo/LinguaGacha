import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, inject, it } from "vitest";
import { InferenceClient } from "../inference/client";
import type { ImageWorkerConfig } from "./engine";

it("部署后的单图片 Worker 按需复用 bubble 会话，并在失败后释放原生资源", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-worker-"));
  try {
    const module = path.join(directory, "ort.mjs");
    await fs.writeFile(
      module,
      `
      const live=new Set();const created=new Set();
      export class Tensor {
        constructor(type,data,dims){this.data=data;this.dims=dims;live.add(this)}
        dispose(){if(!live.delete(this))throw Error('double disposal')}
      }
      export const InferenceSession={create:async (kind, options)=>{if(options.executionProviders[0]==='webgpu')throw Error('fixture backend unavailable');if(created.has(kind))throw Error('session recreated');created.add(kind);return ({
        inputNames:['images'], outputNames:['output0','output1'],
        async run(feeds){
          const value=Object.values(feeds)[0].data[0];
          if(value<0)throw Error('fixture inference failure');
          const channels=value===2?39:37;
          return {output0:new Tensor('float32',new Float32Array(channels*21).fill(value===3?NaN:1),[1,channels,21]),output1:new Tensor('float32',new Float32Array(32*8*8).fill(2),[1,32,8,8])};
        },
        async release(){if(live.size)throw Error('unreleased tensors')}
      })}};
    `,
    );
    const client = new InferenceClient(
      {
        ort: pathToFileURL(module).href,
        device: "cpu",
        models: { bubble: "bubble" },
      } satisfies ImageWorkerConfig,
      path.join(inject("workspaceRuntimeDirectory"), "runtime/image-worker.mjs"),
    );
    const request = (value: number) =>
      client.request(
        "image",
        { kind: "bubble" },
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
    } finally {
      await client.close();
    }
    const unavailable = new InferenceClient(
      {
        ort: pathToFileURL(module).href,
        device: "webgpu",
        models: { bubble: "bubble" },
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
