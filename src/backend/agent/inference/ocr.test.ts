import { expect, it } from "vitest";
import { detect_text, recognize_tokens } from "./ocr";
import type { Ort, OrtSession, OrtTensor } from "./ort";

/** 记录共享 OCR 是否释放原生张量。 */
class Tensor implements OrtTensor {
  public disposed = false;

  public constructor(
    _type: string,
    public readonly data: Float32Array | Int32Array,
    public readonly dims: readonly number[],
  ) {}

  public dispose(): void {
    this.disposed = true;
  }
}

const ort = {
  Tensor,
  InferenceSession: { create: async () => undefined as never },
} satisfies Ort;

const session = (output: OrtTensor): OrtSession => ({
  inputNames: ["input"],
  outputNames: ["output"],
  run: async () => ({ output }),
  release: async () => undefined,
});

it("validates the detection probability map and releases the output", async () => {
  const output = new Tensor("float32", new Float32Array(4).fill(0.5), [1, 1, 2, 2]);
  const result = await detect_text(ort, session(output), new Float32Array(12), [1, 3, 2, 2]);
  expect(result.shape).toEqual([2, 2]);
  expect(result.data).toEqual(new Float32Array(4).fill(0.5));
  expect(output.disposed).toBe(true);

  const invalid = new Tensor("float32", new Float32Array(4).fill(2), [1, 1, 2, 2]);
  await expect(
    detect_text(ort, session(invalid), new Float32Array(12), [1, 3, 2, 2]),
  ).rejects.toThrow("probability map");
  expect(invalid.disposed).toBe(true);
});

it("decodes CTC tokens and rejects incompatible recognition tensors", async () => {
  const data = new Float32Array(18);
  [0, 1, 1, 0, 1, 2].forEach((id, step) => (data[step * 3 + id] = 1));
  const output = new Tensor("float32", data, [1, 6, 3]);
  await expect(
    recognize_tokens(ort, session(output), new Float32Array(3 * 48 * 16), [1, 3, 48, 16]),
  ).resolves.toEqual({ tokens: [1, 1, 2], classes: 3 });
  expect(output.disposed).toBe(true);

  await expect(
    recognize_tokens(ort, session(output), new Float32Array(3 * 32 * 16), [1, 3, 32, 16]),
  ).rejects.toThrow("recognition input");
});
