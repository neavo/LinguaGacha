import { evb_fixture } from "./evb-fixture";

/** 独立 PE 原稿布局：两个原节、两个异常记录、TLS 与 overlay，预期不调用生产解析器。 */
export function evb_pe_fixture(
  x64: boolean,
  relocated: boolean,
  variant: "7_80" | "9_70" | "10_70" = "9_70",
) {
  const base = evb_fixture(new Map([["text.txt", Buffer.from("fixture")]]), x64, variant);
  const overlay = Buffer.from("OVERLAYcertificate-tail");
  const packed = Buffer.alloc(base.length + 512 + overlay.length);
  base.subarray(0, 1024).copy(packed);
  base.subarray(1024).copy(packed, 1536);
  overlay.copy(packed, base.length + 512);
  const section_headers = 88 + (x64 ? 240 : 224),
    directories = 88 + (x64 ? 112 : 96);
  packed.writeUInt16LE(4, 70);
  base.subarray(section_headers + 40, section_headers + 120).copy(packed, section_headers + 80);
  packed.fill(0, section_headers + 40, section_headers + 80);
  packed.write(".pdata", section_headers + 40, "ascii");
  const stride = x64 ? 12 : 20,
    table = Buffer.alloc(2 * stride);
  table.writeUInt32LE(0x1100);
  table.writeUInt32LE(0x1120, 4);
  table.writeUInt32LE(0x1150, 8);
  table.writeUInt32LE(0x1120, stride);
  table.writeUInt32LE(0x1140, stride + 4);
  table.writeUInt32LE(0x1160, stride + 8);
  packed.writeUInt32LE(table.length, section_headers + 48);
  packed.writeUInt32LE(0x2000, section_headers + 52);
  packed.writeUInt32LE(512, section_headers + 56);
  packed.writeUInt32LE(1024, section_headers + 60);
  const enigma2 = base.length; // 原末节被新增的 .pdata 向后移动 512 字节。
  packed.writeUInt32LE(1536, section_headers + 100);
  packed.writeUInt32LE(0x3000, section_headers + 92);
  packed.writeUInt32LE(enigma2, section_headers + 140);
  packed.writeUInt32LE(0x9000, section_headers + 132);
  packed.writeUInt32LE(0x3000, directories + 8);
  if (relocated) {
    table.copy(packed, enigma2 + 64);
    packed.writeUInt32LE(0x9000, enigma2 + 64 + table.length);
    packed.writeUInt32LE(0x9040, directories + 24);
    packed.writeUInt32LE(table.length + stride, directories + 28);
  } else {
    table.copy(packed, 1024);
    packed.writeUInt32LE(0x2000, directories + 24);
    packed.writeUInt32LE(table.length, directories + 28);
  }
  const image_base = x64 ? 0x140000000n : 0x400000n,
    width = x64 ? 8 : 4;
  if (x64) packed.writeBigUInt64LE(image_base, 88 + 24);
  else packed.writeUInt32LE(Number(image_base), 88 + 28);
  const tls = Buffer.alloc(x64 ? 40 : 24);
  for (const [index, rva] of [0x1180, 0x1184, 0x1190, 0x11a0].entries()) {
    if (x64) tls.writeBigUInt64LE(image_base + BigInt(rva), index * width);
    else tls.writeUInt32LE(Number(image_base) + rva, index * width);
  }
  tls.copy(packed, 640);
  tls.subarray(0, 12).copy(packed, 1536);
  if (x64) packed.writeBigUInt64LE(image_base + 0x1100n, 928);
  else packed.writeUInt32LE(Number(image_base) + 0x1100, 928);
  packed.writeUInt32LE(0x30c0, directories + 72);
  packed.writeUInt32LE(tls.length, directories + 76);
  packed.writeUInt32LE(base.length + 512 + 7, directories + 32);
  packed.writeUInt32LE(11, directories + 36);
  return { packed, table, tls, overlay, directories, section_headers };
}
