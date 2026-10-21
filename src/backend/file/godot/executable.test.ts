import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { godot_executable_fixture } from "../../../test/godot-fixture";
import { read_executable, repair_executable } from "./executable";

it.each([64, 4096])(
  "剥离 PCK 节声明大小 %s 时修正物理引用并保留虚拟布局，拒绝错误截断",
  async (declared_size) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-pe-"));
    const native = new NativeFs(),
      prefix = godot_executable_fixture();
    prefix.writeUInt16LE(4, 70);
    prefix.write("pck", 448);
    prefix.writeUInt32LE(8, 456);
    prefix.writeUInt32LE(8192, 460);
    prefix.writeUInt32LE(declared_size, 464);
    prefix.writeUInt32LE(prefix.length, 468);
    const input_path = path.join(temp.path, "original.exe"),
      output_path = path.join(temp.path, "stripped.exe");
    fs.writeFileSync(input_path, Buffer.concat([prefix, Buffer.alloc(64)]));
    fs.writeFileSync(output_path, prefix);
    const input = await native.open_file(input_path, "r"),
      output = await native.open_file(output_path, "r+");
    try {
      await repair_executable(input, output, prefix.length);
      const section = (await read_executable(output))!.sections[3]!;
      expect(section).toMatchObject({ name: "pck", rva: 8192, raw: 0, size: 0 });
      await expect(repair_executable(input, output, 1600)).rejects.toThrow();
    } finally {
      await input.close();
      await output.close();
    }
  },
);
