import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { read_bytes, write_bytes, copy_range, type BinaryFileHandle } from "../shared/binary";

const HEADER = Buffer.from("5250474d560000000003010000000000", "hex");
const PNG_PREFIX = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const OGG_HEADER_BYTES = 27;
const OGG_CRC_POLYNOMIAL = 0x04c11db7;
const OGG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit++)
    value = (value << 1) ^ (value & 0x80000000 ? OGG_CRC_POLYNOMIAL : 0);
  return value >>> 0;
});
export const MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  ".rpgmvp": ".png",
  ".rpgmvo": ".ogg",
  ".rpgmvm": ".m4a",
  ".png_": ".png",
  ".ogg_": ".ogg",
};

/** 原生加密只改变前十六字节，其余载荷分块复制。 */
export async function decrypt_media(
  source: string,
  destination: string,
  key: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  if (!/^[a-f0-9]{32}$/iu.test(key)) throw new Error("Invalid RPG Maker encryption key");
  const input = await fs.open_file(source, "r");
  try {
    const size = (await input.stat()).size;
    if (size < 32) throw new Error("Truncated RPG Maker media: " + source);
    const header = await read_bytes(input, 0, 32);
    if (!header.subarray(0, 16).equals(HEADER))
      throw new Error("Invalid RPG Maker media header: " + source);
    const bytes = header.subarray(16),
      secret = Buffer.from(key, "hex");
    for (let i = 0; i < 16; i++) bytes[i] = bytes[i]! ^ secret[i]!;
    const extension = path.extname(destination).toLowerCase();
    await validate_media_structure(input, bytes, size - HEADER.length, extension, source);
    signal?.throwIfAborted();
    fs.ensure_parent_dir(destination);
    const output = await fs.open_file(destination, "wx");
    try {
      await write_bytes(output, bytes, 0);
      await copy_range(input, output, 32, size - 32, 16, signal);
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

/** 原生加密没有认证标签；这些检查确认受影响结构，不能认证密钥或全部媒体内容。 */
async function validate_media_structure(
  input: BinaryFileHandle,
  prefix: Buffer,
  size: number,
  extension: string,
  source: string,
): Promise<void> {
  const invalid = () => new Error("Decrypted media structure validation failed: " + source);
  if (extension === ".png") {
    if (size < 33 || !prefix.equals(PNG_PREFIX)) throw invalid();
    return;
  }
  if (extension === ".ogg") {
    if (
      size < OGG_HEADER_BYTES ||
      prefix.subarray(0, 4).toString("ascii") !== "OggS" ||
      prefix[4] !== 0 ||
      (prefix[5]! & ~7) !== 0 ||
      !(prefix[5]! & 2) ||
      prefix[5]! & 1
    )
      throw invalid();
    const header = await read_bytes(input, HEADER.length, OGG_HEADER_BYTES);
    prefix.copy(header);
    if (header.readUInt32LE(18) !== 0) throw invalid();
    const segments = header[26]!;
    if (!segments || OGG_HEADER_BYTES + segments > size) throw invalid();
    const lacing = await read_bytes(input, HEADER.length + OGG_HEADER_BYTES, segments);
    const payload_size = lacing.reduce((total, value) => total + value, 0);
    const page_size = OGG_HEADER_BYTES + segments + payload_size;
    if (page_size > size) throw invalid();
    const page = await read_bytes(input, HEADER.length, page_size);
    prefix.copy(page);
    const expected = page.readUInt32LE(22);
    page.fill(0, 22, 26); // RFC 3533：CRC 字段归零后覆盖完整页，初值与终值均不异或。
    let crc = 0;
    for (const value of page)
      crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ value) & 255]!) >>> 0;
    if (crc !== expected) throw invalid();
    return;
  }
  if (extension === ".m4a") {
    if (prefix.subarray(4, 8).toString("ascii") !== "ftyp") throw invalid();
    const declared = prefix.readUInt32BE();
    const header_size = declared === 1 ? 16 : 8;
    const box_size =
      declared === 1 ? prefix.readBigUInt64BE(8) : BigInt(declared === 0 ? size : declared);
    if (
      box_size < BigInt(header_size + 8) ||
      box_size > BigInt(size) ||
      (box_size - BigInt(header_size + 8)) % 4n !== 0n
    )
      throw invalid();
    // major_brand/minor_version 是任意四字节值，仅验证字段和兼容品牌列表布局。
    if (header_size === 16) await read_bytes(input, HEADER.length + header_size, 8);
    return;
  }
  throw invalid();
}
