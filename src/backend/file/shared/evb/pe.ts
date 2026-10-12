// EVB PE 布局参考 mos9527/evbunpack（Apache-2.0）。
import assert from "node:assert/strict";
import type { NativeFs } from "../../../../native/native-fs";
import {
  copy_range,
  read_bytes,
  write_bytes,
  BINARY_CHUNK_BYTES,
  type BinaryFileHandle,
} from "../binary";
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_EXCEPTION_BYTES = 64 * 1024 * 1024;
export type PE = ReturnType<typeof read_pe>;
export type EVBExecutable = Readonly<{ pe: PE; variant: Variant; length: number }>;
type Section = {
  name: string;
  header: number;
  raw: number; // 节在文件中的起点。
  size: number; // 磁盘范围可包含未映射到内存的 EVB 数据。
  rva: number; // 相对映像基址的内存地址。
  virtual: number; // 节声明的内存范围。
};
export type Variant = "7_80" | "9_70" | "10_70";
export const OFFSETS: Record<Variant, [number, number]> = {
  // 元组分别对应 x86 和 x64 保存头。
  "7_80": [76, 104],
  "9_70": [80, 108],
  "10_70": [84, 120],
};
/** 字段范围完整且可精确表示后，才允许读取二进制值。 */
function range(b: Buffer, offset: number, size: number): void {
  assert(
    Number.isSafeInteger(offset) &&
      Number.isSafeInteger(size) &&
      offset >= 0 &&
      size >= 0 &&
      offset + size <= b.length,
    "Truncated or invalid range",
  );
}
/** PE 的四字节字段使用小端序，读取前检查完整范围。 */
function u32(b: Buffer, offset: number): number {
  range(b, offset, 4);
  return b.readUInt32LE(offset);
}
/** PE 的两字节字段同样拒绝截断输入。 */
function u16(b: Buffer, offset: number): number {
  range(b, offset, 2);
  return b.readUInt16LE(offset);
}
/** 从有界头部建立节映射，磁盘长度用于检查尚未读取的节。 */
export function read_pe(b: Buffer, length: number) {
  assert.equal(u16(b, 0), 0x5a4d);
  const pe = u32(b, 0x3c);
  assert.equal(u32(b, pe), 0x4550);
  const opt = pe + 24,
    magic = u16(b, opt);
  assert(magic === 0x10b || magic === 0x20b);
  const x64 = magic === 0x20b,
    count = u16(b, pe + 6),
    start = opt + u16(b, pe + 20);
  const dirs = opt + (x64 ? 112 : 96);
  range(b, dirs, 16 * 8);
  range(b, start, count * 40);
  const sections: Section[] = Array.from({ length: count }, (_, i) => {
    const h = start + i * 40;
    const s = {
      name: b
        .subarray(h, h + 8)
        .toString("ascii")
        .replace(/\0.*$/s, ""),
      header: h,
      virtual: u32(b, h + 8),
      rva: u32(b, h + 12),
      size: u32(b, h + 16),
      raw: u32(b, h + 20),
    };
    assert(s.raw + s.size <= length, "Truncated PE section");
    return s;
  });
  // `enigma1` 包含磁盘专用载荷，RVA 映射以后一节边界截断。
  function section(rva: number): Section {
    const s = sections.find(
      (s, i) =>
        rva >= s.rva &&
        rva < Math.min(s.rva + Math.max(s.virtual, s.size), sections[i + 1]?.rva ?? Infinity),
    );
    assert(s, "Unmapped RVA");
    return s;
  }
  /** RVA 必须落在可读取的磁盘范围内，零填充的虚拟尾部没有源字节。 */
  function raw(rva: number, size = 1): number {
    const s = section(rva);
    assert(rva - s.rva + size <= s.size, "RVA outside raw section");
    return s.raw + rva - s.rva;
  }
  /** 按 PE 目录编号读取地址和长度，证书目录的地址由调用者按文件偏移解释。 */
  function directory(index: number) {
    return { rva: u32(b, dirs + index * 8), size: u32(b, dirs + index * 8 + 4) };
  }
  return { pe, opt, x64, dirs, sections, section, raw, directory };
}

/** 导入表与重定位表共同确认格式偏移，避免凭单个合理地址选分支。 */
export async function validate_evb_layout(
  handle: BinaryFileHandle,
  pe: PE,
  variant: Variant,
): Promise<void> {
  const section = pe.sections.find((s) => s.name === ".enigma1")!;
  const fields = await read_bytes(handle, section.raw + OFFSETS[variant][pe.x64 ? 1 : 0], 16);
  const originals = pe.sections.filter((s) => !s.name.startsWith(".enigma"));
  const original = (rva: number, size: number) =>
    size > 0 && originals.some((s) => rva >= s.rva && rva + size <= s.rva + s.size);
  const imports = fields.readUInt32LE(),
    size = fields.readUInt32LE(4);
  const reloc = fields.readUInt32LE(8),
    reloc_size = fields.readUInt32LE(12);
  assert(original(imports, size) && size <= MAX_HEADER_BYTES);
  assert((reloc === 0 && reloc_size === 0) || original(reloc, reloc_size));
  const bytes = await read_bytes(handle, pe.raw(imports, size), size);
  let terminated = false,
    count = 0;
  for (let at = 0; at + 20 <= size; at += 20) {
    if (bytes.subarray(at, at + 20).every((v) => v === 0)) {
      terminated = true;
      break;
    }
    const name = bytes.readUInt32LE(at + 12),
      iat = bytes.readUInt32LE(at + 16);
    assert(original(name, 1) && original(iat, pe.x64 ? 8 : 4));
    const s = pe.section(name);
    const text = await read_bytes(handle, pe.raw(name), Math.min(256, s.size - (name - s.rva)));
    const end = text.indexOf(0);
    assert(end > 0 && /^[\x21-\x7e]+$/u.test(text.subarray(0, end).toString("latin1")));
    count++;
  }
  assert(terminated && count > 0);
  for (let at = 0; at < reloc_size;) {
    assert(at + 8 <= reloc_size);
    const block = await read_bytes(handle, pe.raw(reloc + at, 8), 8);
    const block_size = block.readUInt32LE(4);
    assert(
      block.readUInt32LE() % 4096 === 0 &&
        block_size >= 8 &&
        block_size % 2 === 0 &&
        at + block_size <= reloc_size,
    );
    at += block_size;
  }
}

/** 仅恢复已证明的节布局；保留 overlay，安全目录随其位置移动。 */
export async function restore_evb_launcher(
  handle: BinaryFileHandle,
  archive: EVBExecutable,
  destination: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const { pe, variant, length } = archive;
  const en1 = pe.sections.at(-2)!,
    en2 = pe.sections.at(-1)!;
  assert(en1?.name === ".enigma1" && en2?.name === ".enigma2", "Unsupported EVB section order");
  const originals = pe.sections.slice(0, -2);
  assert(
    originals.length && originals.every((s) => s.raw + s.size <= en1.raw),
    "Overlapping original PE sections",
  );
  assert(en1.raw + en1.size <= en2.raw && en2.raw + en2.size <= length, "Overlapping EVB sections");
  const output = await fs.open_file(destination, "wx");
  try {
    await copy_range(handle, output, 0, en1.raw, 0, signal);
    const overlay = en2.raw + en2.size;
    await copy_range(handle, output, overlay, length - overlay, en1.raw, signal);
    const patch = async (at: number, value: number, width = 4) => {
      const b = Buffer.alloc(width);
      if (width === 2) b.writeUInt16LE(value);
      else b.writeUInt32LE(value);
      await write_bytes(output, b, at);
    };
    const directory = async (index: number, rva: number, size: number) => {
      await patch(pe.dirs + index * 8, rva);
      await patch(pe.dirs + index * 8 + 4, size);
    };
    const fields = await read_bytes(handle, en1.raw + OFFSETS[variant][pe.x64 ? 1 : 0], 16);
    await patch(pe.pe + 6, originals.length, 2);
    await directory(1, fields.readUInt32LE(), fields.readUInt32LE(4));
    await directory(5, fields.readUInt32LE(8), fields.readUInt32LE(12));
    const exception = pe.directory(3),
      stride = pe.x64 ? 12 : 20;
    assert(
      exception.size % stride === 0 && exception.size <= MAX_EXCEPTION_BYTES,
      "Unsupported PE exception table",
    );
    const entries: Buffer[] = [];
    if (exception.size) {
      const bytes = await read_bytes(handle, pe.raw(exception.rva, exception.size), exception.size);
      for (let at = 0; at < bytes.length; at += stride) {
        if (pe.section(bytes.readUInt32LE(at)).name.startsWith(".enigma")) break;
        entries.push(bytes.subarray(at, at + stride));
      }
    }
    const table = Buffer.concat(entries);
    if (table.length) {
      let target = originals.find(
        (s) => exception.rva >= s.rva && exception.rva + table.length <= s.rva + s.size,
      );
      let rva = exception.rva;
      if (!target) {
        target = originals.find(
          (s) => s.name === ".pdata" && s.virtual === table.length && s.size >= table.length,
        );
        assert(target && target.size <= MAX_EXCEPTION_BYTES, "Unsupported merged exception table");
        assert(
          (await read_bytes(handle, target.raw, target.size)).every((v) => v === 0),
          "Original exception storage is not empty",
        );
        rva = target.rva;
      }
      await write_bytes(output, table, pe.raw(rva, table.length));
      await directory(3, rva, table.length);
    } else await directory(3, 0, 0);
    const tls = await read_bytes(handle, en1.raw, 12);
    if (tls.every((v) => v === 0)) await directory(9, 0, 0);
    else {
      const matches: number[] = [];
      const width = pe.x64 ? 40 : 24;
      for (const section of originals) {
        for (let at = 0; at < section.size; at += BINARY_CHUNK_BYTES - width) {
          const block = await read_bytes(
            handle,
            section.raw + at,
            Math.min(BINARY_CHUNK_BYTES, section.size - at),
          );
          let found = block.indexOf(tls);
          while (found >= 0) {
            if (found + width <= block.length) matches.push(section.rva + at + found);
            found = block.indexOf(tls, found + 1);
          }
        }
      }
      const unique = [...new Set(matches)];
      assert(unique.length === 1, "Missing or ambiguous original TLS directory");
      const original_tls = await read_bytes(handle, pe.raw(unique[0]!, width), width);
      const image = await read_bytes(handle, pe.opt + (pe.x64 ? 24 : 28), pe.x64 ? 8 : 4);
      const image_base = pe.x64 ? image.readBigUInt64LE() : BigInt(image.readUInt32LE());
      const pointer_width = pe.x64 ? 8 : 4;
      const pointer = (bytes: Buffer, at: number) =>
        pe.x64 ? bytes.readBigUInt64LE(at) : BigInt(bytes.readUInt32LE(at));
      const original_rva = (address: bigint, end = false) => {
        const value = address - image_base;
        assert(value >= 0n && value <= 0xffffffffn, "Invalid original TLS address");
        const rva = Number(value);
        assert(
          originals.some(
            (s) =>
              rva >= s.rva &&
              (end
                ? rva <= s.rva + Math.max(s.virtual, s.size)
                : rva < s.rva + Math.max(s.virtual, s.size)),
          ),
          "TLS address references removed sections",
        );
        return rva;
      };
      for (let index = 0; index < 4; index++) {
        const address = pointer(original_tls, index * pointer_width);
        if (address !== 0n) original_rva(address, index === 1);
      }
      assert(
        pointer(original_tls, 0) <= pointer(original_tls, pointer_width),
        "Invalid TLS raw data range",
      );
      const callbacks = pointer(original_tls, 3 * pointer_width);
      if (callbacks !== 0n) {
        const rva = original_rva(callbacks),
          section = pe.section(rva);
        let terminated = false;
        for (let at = rva; at + pointer_width <= section.rva + section.size; at += pointer_width) {
          signal?.throwIfAborted();
          const address = pointer(
            await read_bytes(handle, pe.raw(at, pointer_width), pointer_width),
            0,
          );
          if (address === 0n) {
            terminated = true;
            break;
          }
          original_rva(address);
        }
        assert(terminated, "Unterminated TLS callback table");
      }
      await directory(9, unique[0]!, width);
    }
    const security = pe.directory(4);
    if (security.size) {
      assert(
        security.rva >= overlay && security.rva + security.size <= length,
        "Unsupported PE certificate location",
      );
      await directory(4, security.rva - overlay + en1.raw, security.size);
    }
    for (const index of [0, 2, 6, 7, 8, 10, 11, 12, 13, 14, 15]) {
      const entry = pe.directory(index);
      assert(
        !entry.size ||
          originals.some(
            (s) =>
              entry.rva >= s.rva && entry.rva + entry.size <= s.rva + Math.max(s.virtual, s.size),
          ),
        "PE directory still references EVB sections",
      );
    }
    const optional = await read_bytes(handle, pe.opt, 68);
    const entry = optional.readUInt32LE(16),
      alignment = optional.readUInt32LE(32);
    assert(
      alignment > 0 &&
        originals.some((s) => entry >= s.rva && entry < s.rva + Math.max(s.virtual, s.size)),
      "Unsupported EVB entry point",
    );
    const image_end = Math.max(...originals.map((s) => s.rva + Math.max(s.virtual, s.size)));
    await patch(pe.opt + 56, Math.ceil(image_end / alignment) * alignment);
    await patch(pe.opt + 64, 0); // EXE 校验和随恢复失效，普通用户态加载器允许零值。
    await write_bytes(output, Buffer.alloc(80), en1.header);
  } finally {
    await output.close();
  }
}
