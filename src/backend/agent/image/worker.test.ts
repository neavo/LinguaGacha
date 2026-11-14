import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, inject, it } from "vitest";
import { InferenceClient } from "../inference/client";
import type { ImageWorkerConfig } from "./engine";

it("部署后的单图片 Worker 按需复用 manga/det/inpaint 三会话，并在失败后释放原生资源", async () => {
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
      export const InferenceSession={create:async kind=>{if(created.has(kind))throw Error('session recreated');created.add(kind);return ({
        inputNames:kind==='inpaint'?['image','mask']:['images'],
        outputNames:kind==='manga'?['output0','output1']:['output'],
        async run(feeds){
          if(Object.values(feeds)[0].data[0]<0)throw Error('fixture inference failure');
          if(kind==='manga')return {output0:new Tensor('float32',new Float32Array(39).fill(1),[1,39,1]),output1:new Tensor('float32',new Float32Array(32).fill(2),[1,32,1,1])};
          if(kind==='det')return {output:new Tensor('float32',new Float32Array(4).fill(0.5),[1,1,2,2])};
          return {output:new Tensor('float32',new Float32Array(feeds.image.data),feeds.image.dims)};
        },
        async release(){if(live.size)throw Error('unreleased tensors')}
      })}};
    `,
    );
    const client = new InferenceClient(
      {
        ort: pathToFileURL(module).href,
        device: "cpu",
        models: { manga: "manga", det: "det", inpaint: "inpaint" },
      } satisfies ImageWorkerConfig,
      path.join(inject("workspaceRuntimeDirectory"), "runtime/image-worker.mjs"),
    );
    const request = (kind: "manga" | "det" | "inpaint", value: number) => {
      const channels = kind === "inpaint" ? 4 : 3;
      return client.request(
        "image",
        { kind },
        { dtype: "float32", shape: [1, channels, 2, 2] },
        new Uint8Array(new Float32Array(channels * 4).fill(value).buffer),
      );
    };
    try {
      await expect(request("manga", -1)).rejects.toThrow("fixture inference failure");
      const mangaReply = await request("manga", 1);
      expect(mangaReply.header.shapes).toEqual([
        [1, 39, 1],
        [1, 32, 1, 1],
      ]);
      expect([...new Float32Array(mangaReply.payload!)]).toEqual([
        ...Array(39).fill(1),
        ...Array(32).fill(2),
      ]);
      const detReply = await request("det", 0.5);
      expect(detReply.header).toEqual({ dtype: "float32", shape: [2, 2] });
      expect([...new Float32Array(detReply.payload!)]).toEqual([0.5, 0.5, 0.5, 0.5]);
      const inpaintReply = await request("inpaint", 1);
      expect(inpaintReply.header.shapes).toEqual([[1, 3, 2, 2]]);
      expect([...new Float32Array(inpaintReply.payload!)]).toEqual(Array(12).fill(1));
    } finally {
      await client.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
