import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { wolf_crypt_vectors } from "../../../test/wolf-crypt-vectors";
import { wolf_vector } from "../../../test/wolf-crypt-fixture";
import { create_wolfx_candidates, type WolfXCandidates } from "./key-collector";
import { encode_wolfx_key, match_wolfx, write_wolfx_plaintext } from "./wolfx";

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

it.each(wolf_crypt_vectors.wolfx)("$name 固定向量通过头部候选筛选并跨块解密", async (vector) => {
  const candidates = create_wolfx_candidates();
  candidates.masters.add(vector.key);
  candidates.strings.set(vector.string_id, new Set([vector.string]));
  candidates.integers.set(vector.integer_id, new Set([vector.integer >>> 0]));
  expect(await decode(wolf_vector(vector.input), candidates)).toEqual(wolf_vector(vector.output));
});

it("CESU-8 保留代理码元，所需索引缺失时不能借用其它变量的值", async () => {
  expect(encode_wolfx_key("🔑").toString("hex")).toBe("eda0bdedb491");
  const vector = wolf_crypt_vectors.wolfx.find((v) => v.name === "string")!,
    candidates = create_wolfx_candidates();
  candidates.strings.set(vector.string_id + 1, new Set([vector.string]));
  expect(await decode(wolf_vector(vector.input), candidates)).toBeNull();
  await expect(decode(Buffer.from("WOLFX"), candidates)).rejects.toThrow("Truncated");
  await expect(decode(Buffer.alloc(1024), candidates)).rejects.toThrow("header");
});

it("同文候选合并，五点采样通过的异文候选报歧义", async () => {
  const candidates = create_wolfx_candidates();
  candidates.strings.set(1, new Set(wolf_crypt_vectors.ambiguity));
  for (const name of ["equivalent", "ambiguous"]) {
    const vector = wolf_crypt_vectors.wolfx.find((v) => v.name === name)!;
    if (name === "equivalent")
      expect(await decode(wolf_vector(vector.input), candidates)).toEqual(
        wolf_vector(vector.output),
      );
    else
      await expect(decode(wolf_vector(vector.input), candidates)).rejects.toThrow(
        "Ambiguous WOLFX plaintext",
      );
  }
});
