import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { godot_executable_fixture, godot_pack_fixture } from "../../../test/godot-fixture";
import { read_pack_header } from "./pack";
import { find_pack_key } from "./key";

it.each(["simd", "pointer", "cross-chunk"])(
  "自动密钥候选与扫描：%s",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-key-scan-"));
    const native = new NativeFs(),
      key = Buffer.alloc(32, 91);
    const scan = kind === "cross-chunk";
    const key_offset = kind === "cross-chunk" ? 1536 + BINARY_IO_CHUNK_BYTES - 16 : 1600;
    const exe = godot_executable_fixture(key, key_offset, scan);
    if (kind === "pointer") {
      exe.writeBigUInt64LE(BigInt(0x140000000 + key_offset + 3584), 1536);
      exe.writeInt32LE(1536 - 535, 531);
    }
    const executable = path.join(temp.path, "game.exe"),
      pack = path.join(temp.path, "game.pck");
    fs.writeFileSync(executable, exe);
    fs.writeFileSync(
      pack,
      godot_pack_fixture(new Map([["name", Buffer.from("payload")]]), {
        encryption_key: key,
        encrypt_directory: true,
        resource_prefix: false,
      }),
    );
    const input = await native.open_file(executable, "r"),
      payload = await native.open_file(pack, "r");
    try {
      const header = await read_pack_header(payload);
      const pending = find_pack_key(
        input,
        payload,
        header.directory + 4,
        header.end,
        true,
        exe.length,
      );
      expect(await pending).toEqual(key);
    } finally {
      await input.close();
      await payload.close();
    }
  },
  15000,
);
