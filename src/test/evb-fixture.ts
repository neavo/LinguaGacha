/** 自建协议夹具，导入表、文件树和明文预期独立于产品解析器。 */
export function evb_fixture(
  files: ReadonlyMap<string, Buffer>,
  x64 = false,
  variant: "7_80" | "9_70" | "10_70" = "10_70",
): Buffer {
  const legacy = variant === "7_80";
  const payloads: Buffer[] = [];
  type Tree = Map<string, Tree | Buffer>;
  const tree: Tree = new Map();
  for (const [name, bytes] of files) {
    const parts = name.split("/");
    let parent = tree;
    for (const part of parts.slice(0, -1)) {
      if (!parent.has(part)) parent.set(part, new Map());
      parent = parent.get(part) as Tree;
    }
    parent.set(parts.at(-1)!, bytes);
  }
  /** 旧布局交错存放目录与载荷，新布局把载荷集中到目录之后。 */
  function node(name: string, value: Tree | Buffer): Buffer {
    const directory = value instanceof Map;
    const label = Buffer.from(name + "\0", "utf16le");
    const header = Buffer.alloc(16);
    header.writeUInt32LE(directory ? value.size : 0, 12);
    const extra = Buffer.alloc(directory ? 25 : legacy ? 49 : 53);
    if (!directory) {
      extra.writeUInt32LE(value.length, 2);
      extra.writeUInt32LE(value.length, legacy ? 41 : 49);
      if (!legacy) payloads.push(value);
    }
    const record = Buffer.concat([header, label, Buffer.from([directory ? 3 : 2]), extra]);
    if (legacy) record.writeUInt32LE(record.length - 4);
    return Buffer.concat([
      record,
      ...(directory ? [...value].map(([key, child]) => node(key, child)) : legacy ? [value] : []),
    ]);
  }
  const nodes = node("%DEFAULT FOLDER%", tree);
  const main = Buffer.alloc(legacy ? 16 : 15);
  main.writeUInt32LE(legacy ? 12 : main.length + nodes.length - 4);
  main[12] = 1;
  const vfs = Buffer.concat([Buffer.from("EVB\0"), Buffer.alloc(60), main, nodes, ...payloads]);
  const enigma_size = Math.ceil((256 + vfs.length) / 512) * 512;
  const output = Buffer.alloc(1024 + enigma_size + 512);
  output.writeUInt16LE(0x5a4d);
  output.writeUInt32LE(64, 60);
  output.writeUInt32LE(0x4550, 64);
  output.writeUInt16LE(x64 ? 0x8664 : 0x14c, 68);
  output.writeUInt16LE(3, 70);
  output.writeUInt16LE(x64 ? 240 : 224, 84);
  const optional = 88,
    directories = optional + (x64 ? 112 : 96);
  output.writeUInt16LE(x64 ? 0x20b : 0x10b, optional);
  output.writeUInt32LE(0x1100, optional + 16);
  output.writeUInt32LE(4096, optional + 32);
  output.writeUInt32LE(512, optional + 36);
  output.writeUInt32LE(0x9000, optional + 56);
  const sections = optional + (x64 ? 240 : 224);
  for (const [index, name, raw, size, rva] of [
    [0, ".text", 512, 512, 0x1000],
    [1, ".enigma1", 1024, enigma_size, 0x2000],
    [2, ".enigma2", 1024 + enigma_size, 512, 0x8000],
  ] as const) {
    const at = sections + index * 40;
    output.write(name, at, "ascii");
    output.writeUInt32LE(512, at + 8);
    output.writeUInt32LE(rva, at + 12);
    output.writeUInt32LE(size, at + 16);
    output.writeUInt32LE(raw, at + 20);
  }
  output.writeUInt32LE(0x1040, 512 + 12);
  output.writeUInt32LE(0x1050, 512 + 16);
  output.write("kernel32.dll\0", 512 + 64, "ascii");
  const saved =
    1024 + (legacy ? (x64 ? 104 : 76) : variant === "9_70" ? (x64 ? 108 : 80) : x64 ? 120 : 84);
  output.writeUInt32LE(0x1000, saved);
  output.writeUInt32LE(40, saved + 4);
  output.writeUInt32LE(0x2000, directories + 8);
  output.writeUInt32LE(40, directories + 12);
  vfs.copy(output, 1280);
  return output;
}
