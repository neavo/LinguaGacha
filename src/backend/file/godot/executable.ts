import assert from "node:assert/strict";
import { read_bytes, write_bytes, type BinaryFileHandle } from "../shared/binary";

export type GodotPeSection = Readonly<{
  name: string;
  header: number;
  rva: number;
  raw: number;
  size: number;
  flags: number;
}>;
export type GodotExecutable = Readonly<{
  optional: number;
  image_base: number;
  sections: readonly GodotPeSection[];
}>;

/** 地址映射和剥离共用同一份有界 PE 元数据。非 PE 的测试载体返回空。 */
export async function read_executable(
  handle: BinaryFileHandle,
  pack_start?: number,
): Promise<GodotExecutable | null> {
  const length = (await handle.stat()).size;
  if (length < 64) return null;
  const dos = await read_bytes(handle, 0, 64);
  if (dos.toString("ascii", 0, 2) !== "MZ") return null;
  const at = dos.readUInt32LE(60);
  assert(at + 24 <= length, "Truncated PE header");
  const pe = await read_bytes(handle, at, 24);
  assert.equal(pe.toString("ascii", 0, 4), "PE\0\0", "Invalid PE signature");
  const count = pe.readUInt16LE(6),
    optional_size = pe.readUInt16LE(20),
    optional = at + 24;
  assert(
    count <= 96 && optional_size >= 112 && optional + optional_size + count * 40 <= length,
    "Invalid PE sections",
  );
  const header = await read_bytes(handle, optional, optional_size);
  const magic = header.readUInt16LE();
  assert([0x10b, 0x20b].includes(magic), "Unsupported PE optional header");
  const image_base = magic === 0x20b ? Number(header.readBigUInt64LE(24)) : header.readUInt32LE(28);
  assert(Number.isSafeInteger(image_base), "Unsafe PE image base");
  const sections: GodotPeSection[] = [];
  const table = await read_bytes(handle, optional + optional_size, count * 40);
  for (let at = 0; at < table.length; at += 40) {
    const raw = table.readUInt32LE(at + 20),
      size = table.readUInt32LE(at + 16);
    const name = table.toString("ascii", at, at + 8).replace(/\0.*$/u, "");
    // 某些导出模板的 PCK 节声明含额外尾部占位；只允许已由包尾协议确认的载体。
    assert(
      raw + size <= length || (name.toLowerCase() === "pck" && raw === pack_start && raw < length),
      "PE section outside executable",
    );
    sections.push({
      name,
      header: optional + optional_size + at,
      rva: table.readUInt32LE(at + 12),
      raw,
      size,
      flags: table.readUInt32LE(at + 36),
    });
  }
  return { optional, image_base, sections };
}

/** 仅映射节内实际存储的字节，虚拟零填充不构成密钥候选。 */
export function executable_address(
  pe: GodotExecutable,
  address: number,
  size: number,
): number | null {
  const rva = address - pe.image_base;
  const section = pe.sections.find(
    (section) => rva >= section.rva && rva + size <= section.rva + section.size,
  );
  return section ? section.raw + rva - section.rva : null;
}

/** 只清除已被截去的 PCK 节和签名文件引用，保留原虚拟地址布局。 */
export async function repair_executable(
  input: BinaryFileHandle,
  output: BinaryFileHandle,
  start: number,
): Promise<void> {
  const pe = await read_executable(input, start);
  if (!pe) return;
  for (const section of pe.sections) {
    if (!section.size || section.raw + section.size <= start) continue;
    assert(
      section.name.toLowerCase() === "pck" && section.raw >= start,
      "EXE truncation overlaps a non-PCK section",
    );
    await write_bytes(output, Buffer.alloc(8), section.header + 16);
  }
  const optional = await read_bytes(input, pe.optional, 112);
  const certificates = pe.optional + (optional.readUInt16LE() === 0x20b ? 144 : 128);
  // DataDirectory[SECURITY] 使用文件偏移，剥离会使原签名失效。
  if (certificates + 8 <= Math.min(start, pe.sections[0]?.header ?? start)) {
    const entry = await read_bytes(input, certificates, 8);
    if (entry.readUInt32LE() || entry.readUInt32LE(4))
      await write_bytes(output, Buffer.alloc(8), certificates);
  }
  await write_bytes(output, Buffer.alloc(4), pe.optional + 64);
}
