import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";

import { read_zip_members, validate_zip_member_path } from "../../file/shared/zip-members";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { default_native_fs as fs } from "../../../native/native-fs";

/** 旧包只经过容器校验并原子展开，领域 skill 决定如何解释成员。 */
export async function unpack(source: string, directory: string): Promise<{ members: string[] }> {
  source = path.resolve(source);
  directory = path.resolve(directory);
  if (fs.exists(directory)) throw new Error("Package output directory already exists");
  await fs.make_dir_async(path.dirname(directory));
  const temporary = `${directory}.${randomUUID()}.tmp`;
  try {
    await fs.make_dir_exclusive(temporary);
    const members = await read_zip_members(fs.read_file(source), source);
    for (const [name, member] of members) {
      const output = path.join(temporary, name);
      await fs.write_file(output, await member.async("uint8array"));
    }
    fs.rename(temporary, directory);
    return { members: [...members.keys()] };
  } finally {
    await fs.remove_async(temporary, { recursive: true, force: true });
  }
}

/** 当前领域材料已经由调用方校验；这里只按稳定路径流式封装。 */
export async function pack(
  directory: string,
  output: string,
): Promise<{ output_path: string; members: number }> {
  directory = path.resolve(directory);
  output = path.resolve(output);
  if (fs.exists(output)) throw new Error("Package output already exists");
  const files = collect_files(directory);
  const paths = new ProjectAssetPathIndex();
  for (const file of files) paths.add(file.member);
  await fs.make_dir_async(path.dirname(output));
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    const zip = new JSZip();
    for (const file of files)
      zip.file(file.member, fs.create_read_stream(file.path), {
        binary: true,
        createFolders: false,
      });
    await pipeline(
      zip.generateNodeStream({ streamFiles: true, compression: "STORE", platform: "UNIX" }),
      fs.create_write_stream(temporary),
    );
    if (fs.exists(output)) throw new Error("Package output already exists");
    fs.rename(temporary, output);
    return { output_path: output, members: files.length };
  } finally {
    await fs.remove_async(temporary, { force: true });
  }
}

/** 只收录真实普通文件；链接和设备文件不能把包目录扩到外部。 */
function collect_files(root: string, directory = root): Array<{ member: string; path: string }> {
  const entries = fs.read_dirents(directory).sort((a, b) => a.name.localeCompare(b.name));
  const files: Array<{ member: string; path: string }> = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collect_files(root, file));
    else if (entry.isFile()) {
      const member = path.relative(root, file).split(path.sep).join("/");
      if (validate_zip_member_path(member) !== member) throw new Error("Invalid package path");
      files.push({ member, path: file });
    } else throw new Error(`Unsupported package member: ${entry.name}`);
  }
  return files;
}
