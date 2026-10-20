import { godot_member_kind, is_translation_type } from "./member";
import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import {
  GameSourceConflictError,
  assert_regular_path,
  is_preparation_path,
} from "../source-file-paths";
import { read_pack } from "./pack";
import { read_resource_type } from "./resource";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
import {
  collect_game_source_files,
  type GameSourceFiles,
  type PreparedGameFiles,
} from "../shared/game/source-files";
import { is_godot_font_file } from "./font";
import { resolve_game_source_input } from "../shared/game/source-input";

export type GodotCarrier =
  | { kind: "pck"; file: string }
  | { kind: "embedded"; start: number }
  | null;
export type GodotSource = Readonly<{
  root: string;
  executable: string;
  carrier: GodotCarrier;
  engine: string;
}>;

/** 布局标志保留坏目录的游戏身份，使失败不会降级为普通文件递归。 */
export function is_godot_root(root: string, fs: NativeFs): boolean {
  return (
    fs.exists(path.join(root, "project.binary")) ||
    fs
      .read_dirents(root)
      .some((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".pck")
  );
}

/** 发现只读目录、包头和内嵌尾部，载体内容校验由准备线程执行。 */
export async function discover_godot_source(
  input: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GodotSource | null> {
  signal?.throwIfAborted();
  const source = resolve_game_source_input(input, fs);
  if (!source) return null;
  const { root } = source;
  assert_regular_path(root, fs);
  const entries = fs.read_dirents(root).filter((entry) => entry.isFile());
  const carriers: { file: string; kind: "pck" | "embedded" }[] = entries
    .filter((entry) => path.extname(entry.name).toLowerCase() === ".pck")
    .map((entry) => ({ file: path.join(root, entry.name), kind: "pck" }));
  for (const entry of entries.filter(
    (entry) => path.extname(entry.name).toLowerCase() === ".exe",
  )) {
    signal?.throwIfAborted();
    const file = path.join(root, entry.name);
    assert_regular_path(file, fs);
    const size = fs.stat(file).size;
    if (size < 12) continue;
    const footer = await fs.read_range(file, size - 12, 12);
    if (footer.subarray(8).toString() === "GDPC") carriers.push({ file, kind: "embedded" });
    else {
      // 只有 PE section 的内嵌布局也须报告，不允许把它误当成已展开游戏。
      const dos = fs.read_prefix(file, 64);
      if (dos.toString("ascii", 0, 2) !== "MZ" || dos.length < 64) continue;
      const pe = await fs.read_range(file, dos.readUInt32LE(60), 24);
      if (pe.length < 24 || pe.toString("ascii", 0, 4) !== "PE\0\0") continue;
      const count = pe.readUInt16LE(6),
        optional = pe.readUInt16LE(20);
      assert(count <= 96, "Invalid PE section count");
      const sections = await fs.read_range(file, dos.readUInt32LE(60) + 24 + optional, count * 40);
      for (let at = 0; at + 40 <= sections.length; at += 40) {
        if (
          sections
            .toString("ascii", at, at + 8)
            .replace(/\0.*$/u, "")
            .toLowerCase() !== "pck"
        )
          continue;
        const offset = sections.readUInt32LE(at + 20);
        // 导出模板的 pck 节可只有零占位，展开后的引擎前缀也保留旧节表，只有实际包头才说明未知内嵌布局。
        if (
          sections.readUInt32LE(at + 16) >= 4 &&
          offset + 4 <= size &&
          (await fs.read_range(file, offset, 4)).toString() === "GDPC"
        )
          throw new Error("Unsupported embedded PCK layout: " + file);
      }
    }
  }
  if (carriers.length > 1) throw new GameSourceConflictError("Conflicting Godot carriers: " + root);
  const carrier = carriers[0];
  if (carrier) {
    assert_regular_path(carrier.file, fs);
    const handle = await fs.open_file(carrier.file, "r");
    try {
      const pack = await read_pack(handle, signal);
      if (carrier.kind === "pck")
        assert.equal(pack.start, 0, "External PCK contains an executable prefix");
      const name = path.basename(carrier.file, path.extname(carrier.file));
      const executable =
        carrier.kind === "embedded"
          ? carrier.file
          : path.join(
              root,
              entries.find(
                (entry) =>
                  path.extname(entry.name).toLowerCase() === ".exe" &&
                  [
                    path.basename(entry.name, path.extname(entry.name)).toLowerCase(),
                    entry.name.toLowerCase(),
                  ].includes(name.toLowerCase()),
              )?.name ?? name + ".exe",
            );
      return {
        root,
        executable,
        engine: pack.engine.join("."),
        carrier:
          carrier.kind === "pck"
            ? { kind: "pck", file: carrier.file }
            : { kind: "embedded", start: pack.start },
      };
    } finally {
      await handle.close();
    }
  }
  if (!fs.exists(path.join(root, "project.binary")) || !fs.exists(path.join(root, ".godot")))
    return null;
  assert(fs.stat(path.join(root, ".godot")).isDirectory(), "Invalid Godot resource directory");
  const executable =
    source.executable ??
    path.join(
      root,
      entries.find((entry) => path.extname(entry.name).toLowerCase() === ".exe")?.name ??
        "Game.exe",
    );
  return { root, executable, carrier: null, engine: "4" };
}

/** 资源头只读顶层类型，坏候选仍进入容器，由成员解析边界报告并保留。 */
export function collect_godot_files(
  game: GodotSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  const roots = fs
    .read_dirents(game.root)
    .map((entry) => entry.name)
    .filter((name) => !is_preparation_path(name))
    .sort((a, b) => a.localeCompare(b));
  return collect_game_source_files(
    game.root,
    roots,
    (files) => {
      const names: string[] = [];
      for (const [name, file] of files) {
        signal?.throwIfAborted();
        const kind = godot_member_kind(name);
        if (kind === null) continue;
        assert_regular_path(file, fs);
        // 二进制候选按文件头判断：GDSC 直接保留，其余读取资源类型过滤素材。
        if (
          (kind === "resource" || kind === "translation" || kind === "gdsc") &&
          fs.read_prefix(file, 4).toString("ascii") !== "GDSC"
        ) {
          let type: string | null;
          try {
            type = read_resource_type((length) => fs.read_prefix(file, length));
          } catch {
            type = null; // 坏候选交给成员解析告警，保留原字节。
          }
          if (
            type !== null &&
            !["PackedScene", "Resource"].includes(type) &&
            !is_translation_type(type)
          )
            continue;
        }
        // 从暂存优先的实际路径读头，上限只约束入选成员。
        assert(
          fs.stat(file).size <= GODOT_RESOURCE_MAX_BYTES,
          "Godot member exceeds format processing limit: " + name,
        );
        names.push(name);
      }
      assert(names.includes("project.binary"), "Missing Godot project.binary");
      return names;
    },
    is_godot_font_file,
    fs,
    signal,
    prepared,
  );
}
