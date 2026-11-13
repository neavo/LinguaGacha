/** 本模块使用的 onnxruntime-node 子集。 */
export type OrtTensor = {
  readonly data: unknown;
  readonly dims: readonly number[];
  dispose(): void;
};
export type OrtSession = {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
};
export type Ort = {
  InferenceSession: {
    create(file: string, options: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array | Int32Array, dims: readonly number[]) => OrtTensor;
};

/** 原生输出通过类型校验后才能交给解码与检测。 */
export const float = (data: unknown): Float32Array => {
  if (!(data instanceof Float32Array)) throw new Error("Model output is not float32.");
  return data;
};

/** GPU 输出可能因设备故障出现 NaN，必须当作失败而不是空结果。 */
export function check_finite(data: Float32Array): void {
  for (const value of data)
    if (!Number.isFinite(value)) throw new Error("Model output is not finite.");
}

/** 运行一次，输入张量用后即释放。 */
export async function infer(
  session: OrtSession,
  feeds: Record<string, OrtTensor>,
): Promise<Record<string, OrtTensor>> {
  try {
    return await session.run(feeds);
  } finally {
    for (const tensor of Object.values(feeds)) tensor.dispose();
  }
}
