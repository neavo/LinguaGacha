import { aes_ctr, rng } from "../backend/file/wolfrpg/crypt";
import iconv from "iconv-lite";
import {
  aes_keys,
  FREE_CHACHA_KEY,
  generate_key,
  old_key,
  OLD_PASSWORDS,
  xor,
  is_wolf35,
  type WolfKey,
} from "../backend/file/wolfrpg/archive-crypt";

/** Huffman 使用固定等权树，数据按反转位序编码，独立于生产解码器。 */
export function wolf_huffman_fixture(input: Buffer): Buffer {
  const bits: number[] = [];
  // Huffman 头部按高位优先组装，正文使用反转后的位序。
  const put = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  for (const size of [input.length, input.length]) {
    const width = Math.max(1, Math.ceil(Math.log2(size + 1)));
    put(width - 1, 6);
    put(size, width);
  }
  for (let i = 0; i < 256; i++) {
    put(0, 3);
    put(0, 1);
    put(i === 0 ? 1 : 0, 2);
  }
  const header = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => {
    header[i >>> 3]! |= bit << (7 - (i & 7));
  });
  const body = Buffer.from(
    input.map((value) => {
      let result = 0;
      for (let i = 0; i < 8; i++) result = (result << 1) | ((value >>> i) & 1);
      return result;
    }),
  );
  return Buffer.concat([header, body]);
}
/** DX LZ literal 编码使用零作为转义字节。 */
export function wolf_dx_lz_fixture(input: Buffer): Buffer {
  const body = Buffer.from([...input].flatMap((byte) => (byte === 0 ? [0, 0] : [byte])));
  const header = Buffer.alloc(9);
  header.writeUInt32LE(input.length);
  header.writeUInt32LE(body.length + 9, 4);
  return Buffer.concat([header, body]);
}
type Entry = {
  name: string;
  path: string;
  directory: boolean;
  children: Entry[];
  dir_offset: number;
  name_offset: number;
  file_offset: number;
  upper: Buffer;
  parents: Buffer[];
};
/** 测试自有归档封装，目录布局和载荷由夹具独立组装。 */
export async function wolf_archive_fixture(
  files: ReadonlyMap<string, Buffer>,
  version = 331,
  options: {
    clear?: boolean;
    companion?: Buffer;
    compression?: "lz" | "huffman" | "both" | "partial";
    empty_directory?: boolean;
  } = {},
): Promise<Buffer> {
  const root: Entry = {
    name: "",
    path: "",
    directory: true,
    children: [],
    dir_offset: 0,
    name_offset: 0,
    file_offset: 0,
    upper: Buffer.alloc(0),
    parents: [],
  };
  const entries = new Map<string, Entry>();
  const directories = [root];
  for (const name of [...files.keys(), ...(options.empty_directory ? ["Empty/"] : [])]) {
    const parts = name.split("/").filter(Boolean);
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join("/");
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          name: parts[i]!,
          path: key,
          directory: i < parts.length - 1 || name.endsWith("/"),
          children: [],
          dir_offset: 0,
          name_offset: 0,
          file_offset: 0,
          upper: iconv.encode(parts[i]!.toUpperCase(), "cp932"),
          parents: parent === root ? [] : [parent.upper, ...parent.parents],
        };
        entries.set(key, entry);
        parent.children.push(entry);
        if (entry.directory) directories.push(entry);
      }
      parent = entry;
    }
  }
  const names: Buffer[] = [];
  let name_size = 0,
    record_count = 0;
  for (const entry of entries.values()) {
    entry.name_offset = name_size;
    const encoded = iconv.encode(entry.name, "cp932"),
      units = Math.ceil((entry.upper.length + 1) / 4),
      original_units = Math.ceil((encoded.length + 1) / 4);
    const bytes = Buffer.alloc(4 + units * 4 + original_units * 4);
    bytes.writeUInt16LE(units);
    entry.upper.copy(bytes, 4);
    encoded.copy(bytes, 4 + units * 4);
    names.push(bytes);
    name_size += bytes.length;
  }
  directories.forEach((dir, i) => {
    dir.dir_offset = i * 32;
    dir.file_offset = record_count * 72;
    record_count += dir.children.length;
  });
  const table = Buffer.alloc(record_count * 72),
    dir_table = Buffer.alloc(directories.length * 32),
    data: Buffer[] = [];
  const pw = Uint8Array.from({ length: 15 }, (_, i) => i + 1);
  const modern = [331, 350, 1010, 1020].includes(version);
  const companion = options.companion;
  const password =
    version === 1000 || version >= 1010
      ? companion!.subarray(0, companion!.indexOf(0))
      : OLD_PASSWORDS[version];
  const tail = version >= 1010 ? companion!.subarray(companion!.indexOf(0) + 1) : undefined;
  const stream: WolfKey | null =
    version === 100 || version === 200 ? Uint8Array.from(companion ?? FREE_CHACHA_KEY) : null;
  if (stream) stream.chacha = true;
  const inner = modern
    ? generate_key(pw, false, version, undefined, tail)
    : options.clear
      ? null
      : (stream ?? old_key(password!));
  let data_size = 0;
  for (const dir of directories) {
    dir_table.writeBigUInt64LE(BigInt(dir.children.length), dir.dir_offset + 16);
    dir_table.writeBigUInt64LE(BigInt(dir.file_offset), dir.dir_offset + 24);
    dir.children.forEach((entry, index) => {
      const at = dir.file_offset + index * 72;
      table.writeBigUInt64LE(BigInt(entry.name_offset), at);
      table.writeBigUInt64LE(entry.directory ? 16n : 0n, at + 8);
      if (entry.directory) {
        table.writeBigUInt64LE(BigInt(entry.dir_offset), at + 40);
        return;
      }
      const bytes = files.get(entry.path)!;
      let packed = bytes,
        lz_size = -1,
        huffman_size = -1;
      if (options.compression === "lz" || options.compression === "both") {
        packed = wolf_dx_lz_fixture(bytes);
        lz_size = packed.length;
      }
      if (["huffman", "both", "partial"].includes(options.compression ?? "")) {
        const partial = options.compression === "partial" && packed.length > 2048;
        const huffman = wolf_huffman_fixture(
          partial ? Buffer.concat([packed.subarray(0, 1024), packed.subarray(-1024)]) : packed,
        );
        huffman_size = huffman.length;
        packed = partial ? Buffer.concat([huffman, packed.subarray(1024, -1024)]) : huffman;
      }
      const key =
        !modern && !options.clear
          ? (stream ?? old_key(Buffer.concat([password!, entry.upper, ...entry.parents])))
          : inner;
      data.push(xor(Buffer.from(packed), key, bytes.length));
      for (const [offset, value] of [
        [40, data_size],
        [48, bytes.length],
        [56, lz_size],
        [64, huffman_size],
      ])
        table.writeBigUInt64LE(value! < 0 ? 0xffffffffffffffffn : BigInt(value!), at + offset!);
      data_size += packed.length;
    });
  }
  const directory = Buffer.concat([...names, table, dir_table]),
    compress_dir = !!options.compression;
  const packed_dir = xor(
    compress_dir ? wolf_huffman_fixture(wolf_dx_lz_fixture(directory)) : Buffer.from(directory),
    inner,
    0,
  );
  const head = Buffer.alloc(64);
  head.writeUInt16LE(0x5844);
  head.writeUInt16LE(8, 2);
  head.writeUInt32LE(directory.length, 4);
  head.writeBigUInt64LE(64n, 8);
  head.writeBigUInt64LE(BigInt(64 + data_size), 16);
  head.writeBigUInt64LE(BigInt(name_size), 24);
  head.writeBigUInt64LE(BigInt(name_size + table.length), 32);
  head.writeUInt32LE((version << 16) | (compress_dir ? 0 : 2) | (options.clear ? 1 : 0), 44);
  head[48] = options.compression === "partial" ? 1 : 255;
  head.set(pw, 49);
  const output = Buffer.concat([head, ...data, packed_dir]);
  if (modern) {
    let prefix = Math.min(1024, output.length - 64);
    if (is_wolf35(version)) {
      let state =
        (tail ? tail[0]! * tail[1]! + pw[2]! * pw[4]! + pw[11]! : pw[2]! * pw[4]! + pw[12]!) || 1;
      const next = () => {
        state ^= state << 11;
        state ^= state >>> 19;
        state ^= state << 7;
        return state >>> 0;
      };
      next();
      if (output.length >= (next() % 500) + 800) next();
      prefix = output.length - 64;
      if (prefix >= (next() % 500) + 800) prefix = (next() % 500) + 800;
    }
    const keys = aes_keys(pw, version, tail);
    await aes_ctr(output.subarray(64 + data_size), keys, Math.ceil(prefix / 16));
    await aes_ctr(output.subarray(64, 64 + prefix), keys);
    if (output.length > 128)
      xor(output.subarray(64, output.length - 64), generate_key(pw, true, version, password), 64);
    const random = rng(
      is_wolf35(version) ? 12 + pw[9]! * pw[10]! + pw[3]! : pw[0]! + pw[7]! * pw[12]!,
    );
    for (let i = 0; i < (is_wolf35(version) ? 2 : 4); i++)
      for (let j = 3; j >= 0; j--) {
        const at = 8 + i * 8 + j * 2;
        output.writeUInt16LE(output.readUInt16LE(at) ^ random(), at);
      }
    if (is_wolf35(version)) {
      const r0 = BigInt(random()) << 17n,
        r1 = BigInt(random()) << 31n;
      output.writeBigUInt64LE(output.readBigUInt64LE(24) ^ (r0 | r1 | BigInt(random())), 24);
      for (let i = 3; i >= 0; i--)
        output.writeUInt16LE(output.readUInt16LE(32 + i * 2) ^ random(), 32 + i * 2);
    }
  }
  return output;
}
