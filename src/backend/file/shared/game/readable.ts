export type ReadableFile = readonly [name: string, content: Uint8Array];

/** 序列化供工作区读取的成员投影。 */
export const readable_json = (value: unknown): string => JSON.stringify(value, null, 2);

/** 单个成员解析失败时只写出 `{ internal_file_path, error }`，其余成员照常生成视图。 */
export async function* write_projection(
  file: string,
  read: () => (readonly [string, string])[] | Promise<(readonly [string, string])[]>,
): AsyncGenerator<ReadableFile> {
  let outputs: (readonly [string, string])[];
  try {
    outputs = await read();
  } catch (error) {
    outputs = [
      [
        file + ".json",
        readable_json({
          internal_file_path: file,
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
    ];
  }
  for (const [name, text] of outputs) yield [name, Buffer.from(text)];
}
