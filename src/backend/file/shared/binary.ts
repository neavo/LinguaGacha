import type { NativeFs } from "../../../native/native-fs";

export type BinaryFileHandle = Awaited<ReturnType<NativeFs["open_file"]>>;
export const BINARY_CHUNK_BYTES = 64 * 1024;

/** 目录和媒体共享有界读取，短读不能被误认为完整字段。 */
export async function read_bytes(
  handle: BinaryFileHandle,
  offset: number,
  size: number,
): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const result = await handle.read(bytes, read, size - read, offset + read);
    if (!result.bytesRead) throw new Error("Truncated game file");
    read += result.bytesRead;
  }
  return bytes;
}

/** 写满当前块后才允许推进，调用方持有文件句柄。 */
export async function write_bytes(
  handle: BinaryFileHandle,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    if (!result.bytesWritten) throw new Error("Failed to write game file");
    written += result.bytesWritten;
  }
}

/** 文件范围直接复制，包体与媒体大小不决定常驻内存。 */
export async function copy_range(
  input: BinaryFileHandle,
  output: BinaryFileHandle,
  offset: number,
  size: number,
  destination = 0,
  signal?: AbortSignal,
): Promise<void> {
  for (let at = 0; at < size; at += BINARY_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const bytes = await read_bytes(input, offset + at, Math.min(BINARY_CHUNK_BYTES, size - at));
    await write_bytes(output, bytes, destination + at);
  }
}
