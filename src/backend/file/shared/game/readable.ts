export type ReadableFile = readonly [name: string, content: Uint8Array];
export type ProjectionFailure = (file: string, error: unknown) => void;

/** 序列化供工作区读取的成员投影。 */
export const readable_json = (value: unknown): string => JSON.stringify(value, null, 2);

/** 单个成员失败只报告诊断，其余成员继续生成参考。 */
export async function* write_projection(
  file: string,
  read: () => (readonly [string, string])[] | Promise<(readonly [string, string])[]>,
  report?: ProjectionFailure,
  signal?: AbortSignal,
): AsyncGenerator<ReadableFile> {
  signal?.throwIfAborted();
  let outputs: (readonly [string, string])[];
  try {
    outputs = await read();
  } catch (error) {
    signal?.throwIfAborted();
    report?.(file, error);
    return;
  }
  for (const [name, text] of outputs) {
    signal?.throwIfAborted();
    yield [name, Buffer.from(text)];
  }
}
