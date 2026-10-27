import assert from "node:assert/strict";
import path from "node:path";
import { is_json_record } from "../../../domain/json";
import type { NativeFs } from "../../../native/native-fs";
import {
  assert_game_path_spellings,
  assert_regular_path,
  validate_game_path,
} from "../source-file-paths";
import { copy_range, read_bytes, type BinaryFileHandle } from "./binary";

/** 成员只记录读取来源。包内链接已解析为目标文件，`unpacked` 指向归档旁目录中的实际文件名。 */
export type AsarMember = Readonly<{
  offset: number; // 相对归档文件开头的绝对偏移。
  size: number;
  unpacked: string | null;
}>;

/**
 * 只解析一次索引并检查成员边界，成员内容由调用方按需读取，避免一次性读入整包。
 * 格式为 8 字节长度 Pickle 后接索引 Pickle：负载长度、JSON 字节数与 JSON 文本，数据区紧随索引。
 */
export function read_asar(archive: string, fs: NativeFs): Map<string, AsarMember> {
  const archive_size = fs.stat(archive).size;
  const prefix = fs.read_prefix(archive, 8);
  assert(prefix.length === 8 && prefix.readUInt32LE(0) === 4, "Invalid ASAR header: " + archive);
  const data = 8 + prefix.readUInt32LE(4);
  assert(data >= 16 && data <= archive_size, "Invalid ASAR header: " + archive);
  const header = fs.read_prefix(archive, data);
  const length = header.readUInt32LE(12);
  assert(16 + length <= data, "Invalid ASAR header: " + archive);
  const index: unknown = JSON.parse(header.toString("utf8", 16, 16 + length));
  const files = new Map<string, AsarMember>();
  const links = new Map<string, string>();
  const names: string[] = [];
  /** 区分目录、链接、包内文件与归档旁文件，并确定成员数据位置。 */
  function walk(directory: unknown, prefix: string): void {
    assert(is_json_record(directory), "Invalid ASAR directory: " + (prefix || archive));
    for (const [name, entry] of Object.entries(directory)) {
      const member = prefix ? prefix + "/" + name : name;
      assert(!name.includes("/") && is_json_record(entry), "Invalid ASAR entry: " + member);
      validate_game_path(member);
      names.push(member);
      if ("files" in entry) {
        walk(entry["files"], member);
        continue;
      }
      if ("link" in entry) {
        assert(typeof entry["link"] === "string", "Invalid ASAR link: " + member);
        links.set(member, entry["link"]);
        continue;
      }
      const size = entry["size"];
      assert(
        typeof size === "number" && Number.isSafeInteger(size) && size >= 0,
        "Invalid ASAR size: " + member,
      );
      if (entry["unpacked"] === true) {
        files.set(member, { offset: 0, size, unpacked: member });
        continue;
      }
      assert(
        typeof entry["offset"] === "string" && /^\d+$/u.test(entry["offset"]),
        "Invalid ASAR offset: " + member,
      );
      const offset = data + Number(entry["offset"]);
      assert(
        Number.isSafeInteger(offset + size) && offset + size <= archive_size,
        "ASAR member outside archive data: " + member,
      );
      files.set(member, { offset, size, unpacked: null });
    }
  }
  assert(is_json_record(index), "Invalid ASAR header: " + archive);
  walk(index["files"], "");
  assert_game_path_spellings(names);
  /** 链接只能指向包内文件；目录链接、越界、悬空与循环链接都不能物化成普通文件。 */
  function resolve(name: string, seen: Set<string>): AsarMember {
    const file = files.get(name);
    if (file) return file;
    const link = links.get(name);
    assert(link !== undefined, "ASAR link target is missing or a directory: " + name);
    assert(!seen.has(name), "ASAR link cycle: " + name);
    seen.add(name);
    const target = path.posix.normalize(link.replaceAll("\\", "/"));
    assert(
      !path.posix.isAbsolute(target) && target !== ".." && !target.startsWith("../"),
      "ASAR link points outside archive: " + name,
    );
    return resolve(target, seen);
  }
  const members = new Map(files);
  for (const name of links.keys()) members.set(name, resolve(name, new Set()));
  return members;
}

/** 解析器只读取少量配置与脚本，按清单长度一次读入。 */
export async function read_asar_member(
  handle: BinaryFileHandle,
  archive: string,
  member: AsarMember,
  fs: NativeFs,
): Promise<Buffer> {
  if (member.unpacked === null) return read_bytes(handle, member.offset, member.size);
  const file = unpacked_path(archive, member, fs);
  const bytes = fs.read_file(file);
  assert(bytes.length === member.size, "ASAR unpacked file size mismatch: " + file);
  return bytes;
}

/** 包内数据按块复制，归档旁文件按清单长度校验后复制。 */
export async function extract_asar_member(
  handle: BinaryFileHandle,
  archive: string,
  member: AsarMember,
  destination: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  fs.ensure_parent_dir(destination);
  if (member.unpacked !== null) {
    const file = unpacked_path(archive, member, fs);
    assert(fs.stat(file).size === member.size, "ASAR unpacked file size mismatch: " + file);
    fs.copy_file(file, destination);
    return;
  }
  const output = await fs.open_file(destination, "wx");
  try {
    await copy_range(handle, output, member.offset, member.size, 0, signal);
  } finally {
    await output.close();
  }
}

/** 归档旁目录与归档清单同名，拒绝链接与非普通文件。 */
function unpacked_path(archive: string, member: AsarMember, fs: NativeFs): string {
  const file = path.join(archive + ".unpacked", member.unpacked!);
  assert_regular_path(file, fs);
  assert(fs.exists(file) && fs.stat(file).isFile(), "Missing ASAR unpacked file: " + file);
  return file;
}
