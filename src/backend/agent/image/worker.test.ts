import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, inject, it } from "vitest";
import { InferenceClient } from "../inference/client";
import type { ImageWorkerConfig } from "./engine";

it("部署后的图片 Worker 保留张量协议，并在推理失败后释放原生资源", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-worker-"));
  try {
    const module = path.join(directory, "ort.mjs");
    await fs.writeFile(
      module,
      `
      const live=new Set();
      export class Tensor {
        constructor(type,data,dims){this.data=data;this.dims=dims;live.add(this)}
        dispose(){if(!live.delete(this))throw Error('double disposal')}
      }
      export const InferenceSession={create:async kind=>({
        inputNames:kind==='shadow'?['images']:['image','mask'],outputNames:kind==='shadow'?['output0','output1']:['output'],
        async run(feeds){
          if(Object.values(feeds)[0].data[0]<0)throw Error('fixture inference failure');
          return kind==='shadow'
            ? {output0:new Tensor('float32',new Float32Array(39).fill(1),[1,39,1]),output1:new Tensor('float32',new Float32Array(32).fill(2),[1,32,1,1])}
            : {output:new Tensor('float32',new Float32Array(feeds.image.data),feeds.image.dims)};
        },
        async release(){if(live.size)throw Error('unreleased tensors')}
      })};
    `,
    );
    for (const kind of ["shadow", "inpaint"] as const) {
      const client = new InferenceClient(
        {
          ort: pathToFileURL(module).href,
          file: kind,
          kind,
          device: "cpu",
        } satisfies ImageWorkerConfig,
        path.join(inject("workspaceRuntimeDirectory"), "runtime/image-worker.mjs"),
      );
      const channels = kind === "shadow" ? 3 : 4;
      const request = (value: number) =>
        client.request(
          "image",
          { kind },
          { dtype: "float32", shape: [1, channels, 2, 2] },
          new Uint8Array(new Float32Array(channels * 4).fill(value).buffer),
        );
      try {
        await expect(request(-1)).rejects.toThrow("fixture inference failure");
        const reply = await request(1);
        if (kind === "shadow") {
          expect(reply.header.shapes).toEqual([
            [1, 39, 1],
            [1, 32, 1, 1],
          ]);
          expect([...new Float32Array(reply.payload!)]).toEqual([
            ...Array(39).fill(1),
            ...Array(32).fill(2),
          ]);
        } else {
          expect(reply.header.shapes).toEqual([[1, 3, 2, 2]]);
          expect([...new Float32Array(reply.payload!)]).toEqual(Array(12).fill(1));
        }
      } finally {
        await client.close();
      }
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
