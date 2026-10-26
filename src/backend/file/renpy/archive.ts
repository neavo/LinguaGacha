import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { read_bytes, copy_range, write_bytes, type BinaryFileHandle } from "../shared/binary";
import { validate_game_path, assert_game_path_spellings } from "../source-file-paths";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import {
  read_pickle_async,
  resolve_node,
  node_string,
  PICKLE_MAX_BYTES,
  type PickleNode,
} from "./pickle";

export type ArchivePart = { offset: number; size: number; prefix: Buffer };
export type ArchiveMember = { name: string; parts: ArchivePart[]; size: number };
/** 只解析索引并校验片段边界，大资源保持文件区间表示。 */
export async function read_archive(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
): Promise<Map<string, ArchiveMember>> {
  const size = (await handle.stat()).size;
  assert(size >= 25, "Truncated RPA header");
  const header = (await read_bytes(handle, 0, Math.min(size, 34))).toString("ascii");
  const match = /^(RPA-[23]\.0) ([0-9a-fA-F]{16})(?: ([0-9a-fA-F]{8}))?\n/u.exec(header);
  assert(
    match && (match[1] === "RPA-3.0") === Boolean(match[3]),
    "Unsupported RPA header; use an unprotected RPA-2.0 or RPA-3.0 game",
  );
  const offset = Number.parseInt(match[2]!, 16),
    key = BigInt("0x" + (match[3] ?? "0"));
  assert(
    Number.isSafeInteger(offset) && offset >= match[0].length && offset < size,
    "Invalid RPA index offset",
  );
  assert(size - offset <= PICKLE_MAX_BYTES, "RPA index exceeds size limit");
  const graph = await read_pickle_async(
    inflateSync(await read_bytes(handle, offset, size - offset), {
      maxOutputLength: PICKLE_MAX_BYTES,
    }),
    signal,
  );
  const root = resolve_node(graph.root);
  assert(root.kind === "dict", "RPA index must be a dictionary");
  const members = new Map<string, ArchiveMember>(),
    paths = new ProjectAssetPathIndex();
  const integer = (node: PickleNode): number => {
    // BigInt XOR 保留超过 32 位的偏移。
    const value = resolve_node(node).value;
    assert(
      typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value)),
      "Invalid RPA integer",
    );
    const result = Number(BigInt(value) ^ key);
    assert(Number.isSafeInteger(result) && result >= 0, "Invalid RPA offset");
    return result;
  };
  for (let i = 0; i < root.children.length; i += 2) {
    const name = node_string(root.children[i]!).replaceAll("\\", "/");
    validate_game_path(name);
    if (!members.has(name)) paths.add(name);
    const list = resolve_node(root.children[i + 1]!);
    assert(list.kind === "list" && list.children.length > 0, "Invalid RPA member: " + name);
    const parts = list.children.map((entry) => {
      const tuple = resolve_node(entry),
        values = tuple.children;
      assert(
        tuple.kind === "tuple" && (values.length === 2 || values.length === 3),
        "Invalid RPA segment: " + name,
      );
      const start = integer(values[0]!),
        length = integer(values[1]!);
      const value = values[2] ? resolve_node(values[2]).value : Buffer.alloc(0);
      assert(typeof value === "string" || Buffer.isBuffer(value), "Invalid RPA prefix");
      if (typeof value === "string")
        assert(
          [...value].every((char) => char.codePointAt(0)! <= 255),
          "Invalid RPA Latin-1 prefix",
        );
      const prefix = typeof value === "string" ? Buffer.from(value, "latin1") : value;
      assert(
        start >= match[0].length &&
          length >= prefix.length &&
          start + length - prefix.length <= offset,
        "RPA segment outside data: " + name,
      );
      return { offset: start, size: length - prefix.length, prefix };
    });
    const member_size = parts.reduce((total, part) => total + part.size + part.prefix.length, 0);
    assert(Number.isSafeInteger(member_size), "RPA member size overflow");
    members.set(name, { name, parts, size: member_size });
  }
  assert_game_path_spellings([...members.keys()]);
  return members;
}
/** 只有待解析的脚本允许整体读取，资源复制使用流式入口。 */
export async function read_archive_member(
  handle: BinaryFileHandle,
  member: ArchiveMember,
): Promise<Buffer> {
  assert(member.size <= PICKLE_MAX_BYTES, "RPA script exceeds size limit: " + member.name);
  const pieces: Buffer[] = [];
  for (const part of member.parts)
    pieces.push(part.prefix, await read_bytes(handle, part.offset, part.size));
  return Buffer.concat(pieces);
}
/** 前缀属于逻辑成员内容，不占用归档数据区的片段长度。 */
export async function copy_archive_member(
  input: BinaryFileHandle,
  output: BinaryFileHandle,
  member: ArchiveMember,
  signal?: AbortSignal,
): Promise<void> {
  let at = 0;
  for (const part of member.parts) {
    signal?.throwIfAborted();
    await write_bytes(output, part.prefix, at);
    at += part.prefix.length;
    await copy_range(input, output, part.offset, part.size, at, signal);
    at += part.size;
  }
}
