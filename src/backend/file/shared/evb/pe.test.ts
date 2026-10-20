import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { evb_fixture } from "../../../../test/evb-fixture";
import { read_evb } from "./archive";
import { restore_evb_launcher } from "./pe";

/** 独立 PE 原稿布局：两个原节、两个异常记录、TLS 与 overlay，预期不调用生产解析器。 */
function evb_pe_fixture(x64: boolean, relocated: boolean) {
  const base = evb_fixture(new Map([["text.txt", Buffer.from("fixture")]]), x64, "9_70");
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

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])("PE 恢复 x64=%s 迁移异常表=%s 保留末记录、TLS、overlay 与偏移", async (x64, relocated) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-pe-"));
  const { packed, table, tls, overlay, directories, section_headers } = evb_pe_fixture(
    x64!,
    relocated!,
  );
  const source = path.join(temp.path, "packed.exe"),
    output = path.join(temp.path, "restored.exe");
  fs.writeFileSync(source, packed);
  const native = new NativeFs(),
    handle = await native.open_file(source, "r");
  try {
    const archive = (await read_evb(handle))!;
    expect(archive.variant).toBe("9_70");
    await restore_evb_launcher(handle, archive, output, native);
    const restored = fs.readFileSync(output);
    expect(restored.readUInt16LE(70)).toBe(2);
    expect(restored.readUInt32LE(104)).toBe(0x1100);
    expect(restored.readUInt32LE(144)).toBe(0x3000);
    expect(restored.subarray(1024, 1024 + table.length).equals(table)).toBe(true);
    expect(restored.readUInt32LE(directories + 24)).toBe(0x2000);
    expect(restored.readUInt32LE(directories + 28)).toBe(table.length);
    expect(restored.subarray(640, 640 + tls.length).equals(tls)).toBe(true);
    expect(restored.readUInt32LE(directories + 72)).toBe(0x1080);
    expect(restored.readUInt32LE(directories + 76)).toBe(tls.length);
    expect(restored.subarray(1536).equals(overlay)).toBe(true);
    expect(restored.readUInt32LE(directories + 32)).toBe(1543);
    expect(restored.readUInt32LE(directories + 36)).toBe(11);
    expect(restored.readUInt32LE(directories + 8)).toBe(0x1000);
    expect(
      restored.subarray(section_headers + 80, section_headers + 160).equals(Buffer.alloc(80)),
    ).toBe(true);
  } finally {
    await handle.close();
  }
});

it.each(["tls-ambiguous", "tls-address", "tls-callback", "entry", "directory", "occupied-pdata"])(
  "PE 不支持的恢复布局 %s 明确失败",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-pe-bad-"));
    const { packed, tls, directories } = evb_pe_fixture(true, true);
    if (kind === "tls-ambiguous") tls.copy(packed, 720);
    if (kind === "tls-address") packed.writeBigUInt64LE(0x140009000n, 640 + 16);
    if (kind === "tls-callback") packed.writeBigUInt64LE(0x140009000n, 928);
    if (kind === "entry") packed.writeUInt32LE(0x9000, 104);
    if (kind === "directory") {
      packed.writeUInt32LE(0x9000, directories + 96);
      packed.writeUInt32LE(8, directories + 100);
    }
    if (kind === "occupied-pdata") packed[1024] = 1;
    const source = path.join(temp.path, "packed.exe");
    fs.writeFileSync(source, packed);
    const native = new NativeFs(),
      handle = await native.open_file(source, "r");
    try {
      await expect(
        restore_evb_launcher(
          handle,
          (await read_evb(handle))!,
          path.join(temp.path, "out.exe"),
          native,
        ),
      ).rejects.toThrow();
    } finally {
      await handle.close();
    }
  },
);
