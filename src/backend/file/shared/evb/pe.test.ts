import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { evb_pe_fixture } from "../../../../test/evb-pe-fixture";
import { read_evb } from "./archive";
import { restore_evb_launcher } from "./pe";

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
    expect(restored.subarray(1024, 1024 + table.length)).toEqual(table);
    expect(restored.readUInt32LE(directories + 24)).toBe(0x2000);
    expect(restored.readUInt32LE(directories + 28)).toBe(table.length);
    expect(restored.subarray(640, 640 + tls.length)).toEqual(tls);
    expect(restored.readUInt32LE(directories + 72)).toBe(0x1080);
    expect(restored.readUInt32LE(directories + 76)).toBe(tls.length);
    expect(restored.subarray(1536)).toEqual(overlay);
    expect(restored.readUInt32LE(directories + 32)).toBe(1543);
    expect(restored.readUInt32LE(directories + 36)).toBe(11);
    expect(restored.readUInt32LE(directories + 8)).toBe(0x1000);
    expect(restored.subarray(section_headers + 80, section_headers + 160)).toEqual(
      Buffer.alloc(80),
    );
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
