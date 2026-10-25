import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { wolf_vectors, wolf_vector } from "../../../test/wolf-vectors";
import { create_wolfx_candidates, type WolfXCandidates } from "./key-collector";
import { encode_wolfx_key, match_wolfx, write_wolfx_plaintext } from "./wolfx";
import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";

it("IO 块内可取消 WOLFX 计算，未完成的块不写入输出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolfx-compute-cancel-"));
  const source = path.join(temp.path, "input"),
    destination = path.join(temp.path, "output");
  fs.writeFileSync(source, Buffer.alloc(BINARY_IO_CHUNK_BYTES + 37, 42));
  const input = await fs.promises.open(source, "r"),
    output = await fs.promises.open(destination, "w");
  const controller = new AbortController(),
    read = input.read.bind(input);
  Object.assign(input, {
    read: async (buffer: Buffer, offset: number, length: number, position: number) => {
      const result = await read(buffer, offset, length, position);
      // 两次事件循环让出使取消发生在当前 IO 块的计算期间。
      setImmediate(() => setImmediate(() => controller.abort(new Error("cancel computation"))));
      return result;
    },
  });
  try {
    await expect(
      write_wolfx_plaintext(
        input,
        output,
        { offset: 37, length: BINARY_IO_CHUNK_BYTES, stream: new Uint8Array(256) },
        controller.signal,
      ),
    ).rejects.toThrow("cancel computation");
    expect(fs.statSync(destination).size).toBe(0);
  } finally {
    await input.close();
    await output.close();
  }
});

it("大正文跨 IO 块仍按文件偏移推进周期密钥流", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolfx-block-"));
  const stream = Uint8Array.from({ length: 256 }, (_, i) => (i * 73) % 256);
  const offset = 37;
  const expected = Buffer.alloc(BINARY_IO_CHUNK_BYTES + 19).fill(
    Buffer.from(Array.from({ length: 251 }, (_, i) => i)),
  );
  const encoded = Buffer.from(expected.map((byte, i) => byte ^ stream[(offset + i - 10) % 256]!));
  const source = path.join(temp.path, "input"),
    destination = path.join(temp.path, "output");
  fs.writeFileSync(source, Buffer.concat([Buffer.alloc(offset), encoded]));
  const input = await fs.promises.open(source, "r"),
    output = await fs.promises.open(destination, "w");
  try {
    await write_wolfx_plaintext(input, output, { offset, length: expected.length, stream });
    expect(fs.readFileSync(destination).equals(expected)).toBe(true);
  } finally {
    await input.close();
    await output.close();
  }
});

async function decode(bytes: Buffer, candidates: WolfXCandidates): Promise<Buffer | null> {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolfx-"));
  const filename = path.join(temp.path, "input");
  fs.writeFileSync(filename, bytes);
  const input = await fs.promises.open(filename, "r"),
    output = await fs.promises.open(path.join(temp.path, "output"), "w");
  try {
    const { match } = await match_wolfx(input, candidates);
    if (!match) return null;
    await write_wolfx_plaintext(input, output, match);
    return fs.readFileSync(path.join(temp.path, "output"));
  } finally {
    await input.close();
    await output.close();
  }
}

it.each(wolf_vectors.wolfx)("$name 固定向量通过头部候选筛选并跨块解密", async (vector) => {
  const candidates = create_wolfx_candidates();
  candidates.masters.add(vector.key);
  candidates.strings.set(vector.string_id, new Set([vector.string]));
  candidates.integers.set(vector.integer_id, new Set([vector.integer >>> 0]));
  expect(
    (await decode(wolf_vector(vector.input), candidates))!.equals(wolf_vector(vector.output)),
  ).toBe(true);
});

it("CESU-8 保留代理码元，所需索引缺失时不能借用其它变量的值", async () => {
  expect(encode_wolfx_key("🔑").toString("hex")).toBe("eda0bdedb491");
  const vector = wolf_vectors.wolfx.find((v) => v.name === "string")!,
    candidates = create_wolfx_candidates();
  candidates.strings.set(vector.string_id + 1, new Set([vector.string]));
  expect(await decode(wolf_vector(vector.input), candidates)).toBeNull();
  await expect(decode(Buffer.from("WOLFX"), candidates)).rejects.toThrow("Truncated");
  await expect(decode(Buffer.alloc(1024), candidates)).rejects.toThrow("header");
});

it("同文候选合并，五点采样通过的异文候选报歧义", async () => {
  const candidates = create_wolfx_candidates();
  candidates.strings.set(1, new Set(wolf_vectors.ambiguity));
  for (const name of ["equivalent", "ambiguous"]) {
    const vector = wolf_vectors.wolfx.find((v) => v.name === name)!;
    if (name === "equivalent")
      expect(
        (await decode(wolf_vector(vector.input), candidates))!.equals(wolf_vector(vector.output)),
      ).toBe(true);
    else
      await expect(decode(wolf_vector(vector.input), candidates)).rejects.toThrow(
        "Ambiguous WOLFX plaintext",
      );
  }
});
