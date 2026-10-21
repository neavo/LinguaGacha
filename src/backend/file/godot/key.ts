import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { read_bytes, BINARY_IO_CHUNK_BYTES, type BinaryFileHandle } from "../shared/binary";
import { GODOT_CRYPT_HEADER_BYTES, read_encrypted_block } from "./crypt";
import { executable_address, read_executable } from "./executable";

const SCAN_BATCH_KEYS = 2048,
  REFERENCE_RADIUS = 0x2000;
const ENCRYPTED_DIRECTORY_MAX_BYTES = 64 * 1024 * 1024;
const KEY_ANCHORS = [
  "Can't open encrypted pack directory.",
  "Can't open encrypted pack-referenced file",
  'Condition "fae.is_null()" is true.',
  "GDScript::load_byte_code",
];

/** 定位待验证的加密块，探针类型只决定候选的快速筛选方式。 */
export type PackKeyProbe = Readonly<{
  payload: BinaryFileHandle;
  offset: number;
  end: number;
  kind: "directory" | "project" | "unknown";
}>;

/** 最近的有效密钥只属于本次准备，复用与候选均须通过完整 MD5。 */
export function create_pack_key_finder(
  executable: BinaryFileHandle,
  executable_end: number,
  signal?: AbortSignal,
): (probe: PackKeyProbe) => Promise<Buffer> {
  let known: Buffer | undefined; // 仅保存本次准备最近一次通过完整 MD5 的密钥。
  /** 先核对已知密钥，再从当前 EXE 中发现候选。 */
  return async function find_key({ payload, offset, end, kind }: PackKeyProbe): Promise<Buffer> {
    signal?.throwIfAborted();
    const block = await read_encrypted_block(payload, offset, end);
    assert(
      kind !== "directory" || block.size <= ENCRYPTED_DIRECTORY_MAX_BYTES,
      "Encrypted key probe exceeds processing limit",
    );
    const ciphertext_size = block.stored_size - GODOT_CRYPT_HEADER_BYTES;
    const encrypted = await read_bytes(
      payload,
      offset + GODOT_CRYPT_HEADER_BYTES,
      Math.min(ciphertext_size, BINARY_IO_CHUNK_BYTES),
    );
    let processed = 0;
    /** CPU 扫描批次之间交回事件循环，接收 worker 的取消消息。 */
    const checkpoint = async () => {
      await setImmediate();
      signal?.throwIfAborted();
    };
    /** 前缀只淘汰候选，接受密钥必须核对整个明文摘要。 */
    const verify = async (key: Buffer, check_prefix: boolean): Promise<boolean> => {
      signal?.throwIfAborted();
      if (check_prefix && kind === "directory" && block.size >= 12) {
        const prefix = createDecipheriv("aes-256-cfb", key, block.iv).update(
          encrypted.subarray(0, 16),
        );
        const length = prefix.readUInt32LE();
        if (!length || length > 65536 || length + 40 > block.size) return false;
      }
      if (check_prefix && kind === "project" && block.size >= 4) {
        const magic = createDecipheriv("aes-256-cfb", key, block.iv).update(
          encrypted.subarray(0, 4),
        );
        if (magic.toString() !== "ECFG") return false;
      }
      const decipher = createDecipheriv("aes-256-cfb", key, block.iv);
      const digest = createHash("md5");
      for (let at = 0; at < ciphertext_size; at += BINARY_IO_CHUNK_BYTES) {
        const chunk =
          at === 0
            ? encrypted
            : await read_bytes(
                payload,
                offset + GODOT_CRYPT_HEADER_BYTES + at,
                Math.min(BINARY_IO_CHUNK_BYTES, ciphertext_size - at),
              );
        digest.update(
          decipher.update(chunk).subarray(0, Math.max(0, Math.min(chunk.length, block.size - at))),
        );
        if (ciphertext_size > BINARY_IO_CHUNK_BYTES) await checkpoint();
      }
      decipher.final();
      return digest.digest("hex") === block.md5;
    };
    if (known && (await verify(known, false))) return known;
    const pe = await read_executable(executable, executable_end);
    assert(pe, "Automatic Godot key discovery requires a Windows PE executable");
    const regions = pe.sections.filter(
      (section) =>
        section.size >= 32 &&
        section.raw + section.size <= executable_end &&
        section.name.toLowerCase() !== "pck",
    );
    const targets = new Set<number>();
    for (const section of regions.filter((section) => !(section.flags & 0x20000000))) {
      for (let at = 0; at < section.size; at += BINARY_IO_CHUNK_BYTES) {
        await checkpoint();
        const bytes = await read_bytes(
          executable,
          section.raw + at,
          Math.min(BINARY_IO_CHUNK_BYTES + 128, section.size - at),
        );
        for (const anchor of KEY_ANCHORS) {
          let index = -1;
          while ((index = bytes.indexOf(anchor, index + 1)) >= 0)
            targets.add(pe.image_base + section.rva + at + index);
        }
      }
    }
    const candidates = new Set<number>();
    for (const section of regions.filter((section) => section.flags & 0x20000000)) {
      // 指令窗口包含重叠尾部，RIP 位移跨读取块时仍能定位。
      for (let base = 0; base < section.size; base += BINARY_IO_CHUNK_BYTES) {
        await checkpoint();
        const bytes = await read_bytes(
          executable,
          section.raw + base,
          Math.min(BINARY_IO_CHUNK_BYTES + 7, section.size - base),
        );
        for (let at = 0; at + 7 <= bytes.length; at++) {
          if (
            (bytes[at]! & 0xf8) !== 0x48 ||
            bytes[at + 1] !== 0x8d ||
            (bytes[at + 2]! & 0xc7) !== 5
          )
            continue;
          const target = pe.image_base + section.rva + base + at + 7 + bytes.readInt32LE(at + 3);
          if (!targets.has(target)) continue;
          const begin = Math.max(0, base + at - REFERENCE_RADIUS),
            finish = Math.min(section.size, base + at + REFERENCE_RADIUS);
          const window = await read_bytes(executable, section.raw + begin, finish - begin);
          for (let i = 0; i + 7 <= window.length; i++) {
            const direct =
              (window[i]! & 0xf8) === 0x48 &&
              [0x8b, 0x8d].includes(window[i + 1]!) &&
              (window[i + 2]! & 0xc7) === 5;
            const simd =
              window[i] === 0x0f &&
              [0x10, 0x28, 0x6f].includes(window[i + 1]!) &&
              (window[i + 2]! & 0xc7) === 5;
            if (!direct && !simd) continue;
            // 两类 RIP 相对指令从当前操作码起均占 7 字节。
            const displacement = window.readInt32LE(i + 3);
            const mapped = executable_address(
              pe,
              pe.image_base + section.rva + begin + i + 7 + displacement,
              32,
            );
            if (
              mapped !== null &&
              regions.some(
                (region) => mapped >= region.raw && mapped + 32 <= region.raw + region.size,
              )
            )
              candidates.add(mapped);
          }
        }
      }
    }
    // 候选可能保存指针，继续沿 PE 地址映射读取实际密钥。
    for (const offset of candidates) {
      const pointer = Number((await read_bytes(executable, offset, 8)).readBigUInt64LE());
      const mapped = Number.isSafeInteger(pointer) ? executable_address(pe, pointer, 32) : null;
      if (
        mapped !== null &&
        regions.some((region) => mapped >= region.raw && mapped + 32 <= region.raw + region.size)
      )
        candidates.add(mapped);
    }
    /** 指令引用候选优先，随后扫描有效数据区。 */
    const scan = async (check_prefix: boolean): Promise<Buffer | undefined> => {
      for (const offset of candidates) {
        signal?.throwIfAborted();
        const key = await read_bytes(executable, offset, 32);
        if (await verify(key, check_prefix)) return key;
      }
      // 先扫描可写数据，再扫描其余有效数据区域。31 字节重叠覆盖跨块密钥。
      for (const section of regions
        .filter((section) => !(section.flags & 0x20000000))
        .sort(
          (a, b) => Number(Boolean(b.flags & 0x80000000)) - Number(Boolean(a.flags & 0x80000000)),
        )) {
        for (let at = 0; at < section.size; at += BINARY_IO_CHUNK_BYTES) {
          const bytes = await read_bytes(
            executable,
            section.raw + at,
            Math.min(BINARY_IO_CHUNK_BYTES + 31, section.size - at),
          );
          for (let i = 0; i + 32 <= bytes.length && i < BINARY_IO_CHUNK_BYTES; i++) {
            if (++processed % SCAN_BATCH_KEYS === 0) await checkpoint();
            const key = bytes.subarray(i, i + 32);
            if (await verify(key, check_prefix)) return Buffer.from(key);
          }
        }
      }
      return undefined;
    };
    // ECFG 筛选失败后仍完整扫描，头部异常但摘要自洽的成员交给语义解析报告。
    const found = (await scan(true)) ?? (kind === "project" ? await scan(false) : undefined);
    if (found) return (known = found);
    signal?.throwIfAborted();
    throw new Error("Could not locate a valid Godot encryption key in the executable");
  };
}
