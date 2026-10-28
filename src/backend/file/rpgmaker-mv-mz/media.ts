import type { NativeFs } from "../../../native/native-fs";
import { read_bytes, write_bytes, copy_range } from "../shared/binary";

const HEADER = Buffer.from("5250474d560000000003010000000000", "hex");
const KEY_PATTERN = /^[a-f0-9]{32}$/iu;

/** 去除原生加密封装：载荷前缀按密钥异或，其余字节原样复制。封装没有认证信息，不判断媒体格式与可用性。 */
export async function decrypt_media(
  source: string,
  destination: string,
  key: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid RPG Maker encryption key");
  const secret = Buffer.from(key, "hex");
  const input = await fs.open_file(source, "r");
  try {
    const size = (await input.stat()).size;
    const head = await read_bytes(input, 0, Math.min(size, HEADER.length + secret.length));
    if (!head.subarray(0, HEADER.length).equals(HEADER))
      throw new Error("Invalid RPG Maker media header: " + source);
    // 引擎要求载荷至少一个密钥长度。工具按实际字节转换短载荷，不补齐缺失内容。
    const prefix = head.subarray(HEADER.length);
    for (let i = 0; i < prefix.length; i++) prefix[i] = prefix[i]! ^ secret[i]!;
    signal?.throwIfAborted();
    fs.ensure_parent_dir(destination);
    const output = await fs.open_file(destination, "wx");
    try {
      await write_bytes(output, prefix, 0);
      await copy_range(input, output, head.length, size - head.length, prefix.length, signal);
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
