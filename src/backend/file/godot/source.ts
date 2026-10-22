import { GODOT_PACK_ORDER_REFRESH_ACTION } from "../../../shared/godot";
import { godot_member_kind, is_translation_type } from "./member";
import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import {
  GameSourceConflictError,
  assert_regular_path,
  is_preparation_path,
} from "../source-file-paths";
import { read_pack_header, type GodotPackHeader } from "./pack";
import { read_executable } from "./executable";
import type { GodotPackOrder, GodotPackPreview } from "../../../shared/godot";
import { AppError } from "../../../shared/error";
import { read_resource_type } from "./resource";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
import {
  collect_game_source_files,
  type GameSourceData,
  type GameSourceFiles,
  type PreparedGameFiles,
} from "../shared/game/source-files";
import { is_godot_font_file } from "./font";
import { resolve_game_source_input } from "../shared/game/source-input";

export type GodotCarrier = Readonly<{ file: string; header: GodotPackHeader }>;
export type GodotSource = Readonly<{
  root: string;
  executable: string;
  embedded: GodotCarrier | null;
  external: readonly GodotCarrier[];
  settings_file: string | null; // 启动配置的归属先于资源排序确定。
}>;

const EMPTY_PACK_MARKER = Buffer.from("LinguaGacha empty PCK v1");
const EMPTY_PACK_BYTES = 116;

const PACK_NAMES = new Intl.Collator("en", { numeric: true, sensitivity: "base" }); // 默认顺序独立于界面语言。
/** 数字相等时使用字面排序，消除大小写和前导零造成的枚举顺序差异。 */
function compare_pack_names(left: string, right: string): number {
  return PACK_NAMES.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

/** v2 空包供各 Godot 4 模板识别，保留标记支持重复发现。 */
export function create_empty_pack(): Buffer {
  const bytes = Buffer.alloc(EMPTY_PACK_BYTES);
  bytes.write("GDPC");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(4, 8);
  bytes.writeBigUInt64LE(BigInt(EMPTY_PACK_BYTES), 24);
  EMPTY_PACK_MARKER.copy(bytes, 32);
  return bytes;
}

/** 只识别本程序生成的完整零成员结构，普通空包仍按来源处理。 */
function is_empty_pack(file: string, fs: NativeFs): boolean {
  return (
    fs.stat(file).size === EMPTY_PACK_BYTES &&
    fs.read_prefix(file, EMPTY_PACK_BYTES).equals(create_empty_pack())
  );
}

/** 坏包也保留游戏目录身份，防止递归导入其中的普通文件。 */
export function is_godot_root(root: string, fs: NativeFs): boolean {
  return (
    fs.exists(path.join(root, "project.binary")) ||
    fs
      .read_dirents(root)
      .some((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".pck")
  );
}

/** 发现只读包头，不解密目录，避免预览占用准备线程或改写来源。 */
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
  const external: GodotCarrier[] = [];
  const embedded: GodotCarrier[] = [];
  for (const entry of entries) {
    signal?.throwIfAborted();
    const extension = path.extname(entry.name).toLowerCase();
    if (extension !== ".pck" && extension !== ".exe") continue;
    const file = path.join(root, entry.name);
    assert_regular_path(file, fs);
    if (extension === ".pck" && is_empty_pack(file, fs)) continue;
    const handle = await fs.open_file(file, "r");
    try {
      if (extension === ".exe") {
        const size = (await handle.stat()).size;
        if (size < 12) continue;
        const footer = await fs.read_range(file, size - 12, 12);
        if (footer.subarray(8).toString() !== "GDPC") {
          const pe = await read_executable(handle);
          for (const section of pe?.sections ?? [])
            if (
              section.name.toLowerCase() === "pck" &&
              section.size >= 4 &&
              (await fs.read_range(file, section.raw, 4)).toString() === "GDPC"
            )
              throw new Error("Unsupported embedded PCK layout: " + file);
          continue;
        }
      }
      const header = await read_pack_header(handle, signal);
      if (extension === ".pck")
        assert.equal(header.start, 0, "External PCK contains an executable prefix");
      (extension === ".pck" ? external : embedded).push({ file, header });
    } finally {
      await handle.close();
    }
  }
  external.sort((a, b) => compare_pack_names(path.basename(a.file), path.basename(b.file)));
  const selected = source.executable
    ? embedded.find(
        (carrier) => fs.to_identity_path(carrier.file) === fs.to_identity_path(source.executable!),
      )
    : undefined;
  if (embedded.length > 1 && !selected)
    throw new GameSourceConflictError("Multiple Godot executables; select an EXE: " + root);
  const base = selected ?? embedded[0] ?? null;
  const loose =
    fs.exists(path.join(root, "project.binary")) && fs.exists(path.join(root, ".godot"));
  if (!base && !external.length && !loose) return null;
  const executables = entries
    .filter((entry) => path.extname(entry.name).toLowerCase() === ".exe")
    .sort((a, b) => compare_pack_names(a.name, b.name));
  const first = external[0];
  const matched = executables.find((entry) =>
    external.some((carrier) =>
      [entry.name + ".pck", path.parse(entry.name).name + ".pck"].some(
        (name) => path.basename(carrier.file).toLowerCase() === name.toLowerCase(),
      ),
    ),
  );
  const executable =
    base?.file ??
    source.executable ??
    path.join(
      root,
      matched?.name ??
        executables[0]?.name ??
        (first ? path.parse(first.file).name + ".exe" : "Game.exe"),
    );
  const startup =
    base ?? external.find((carrier) => is_startup_pack(carrier.file, executable)) ?? first;
  if (loose && !base && !external.length)
    assert(fs.stat(path.join(root, ".godot")).isDirectory(), "Invalid Godot resource directory");
  return {
    root,
    executable,
    embedded: base,
    external,
    settings_file: startup?.file ?? null,
  };
}

/** 剥离后 EXE 自动尝试的两个启动槽位都不能留下空包。 */
export function is_startup_pack(file: string, executable: string): boolean {
  return [
    executable + ".pck",
    path.join(path.dirname(executable), path.parse(executable).name + ".pck"),
  ].some((slot) => slot.toLowerCase() === file.toLowerCase());
}

/** 预览仅暴露目录和包名，载体及密钥留在后端。 */
export function godot_pack_preview(game: GodotSource) {
  return {
    game_root: game.root,
    game_name: path.basename(game.root),
    external_pcks: game.external.map((carrier) => path.basename(carrier.file)),
  } satisfies GodotPackPreview;
}

/** 请求边界拒绝重复游戏和非字符串列表，集合核对由来源持有者完成。 */
export function read_godot_pack_orders(value: unknown): readonly GodotPackOrder[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AppError("request.validation_failed");
  const roots = new Set<string>();
  return value.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("game_root" in entry) ||
      typeof entry.game_root !== "string" ||
      !entry.game_root ||
      !("ordered_pcks" in entry) ||
      !Array.isArray(entry.ordered_pcks) ||
      !entry.ordered_pcks.every((name: unknown) => typeof name === "string")
    )
      throw new AppError("request.validation_failed");
    const root = path.resolve(entry.game_root).toLowerCase();
    if (roots.has(root)) throw new AppError("request.validation_failed");
    roots.add(root);
    return { game_root: entry.game_root, ordered_pcks: [...entry.ordered_pcks] };
  });
}

/** 确认顺序须完整匹配当前集合，来源变化时让界面重新预览。 */
export function apply_godot_pack_order(game: GodotSource, order: GodotPackOrder): GodotSource {
  const carriers = new Map(game.external.map((carrier) => [path.basename(carrier.file), carrier]));
  const names = order.ordered_pcks;
  if (
    path.resolve(order.game_root).toLowerCase() !== game.root.toLowerCase() ||
    names.length !== carriers.size ||
    new Set(names).size !== names.length ||
    names.some((name) => !carriers.has(name))
  )
    throw new AppError("request.validation_failed", {
      message: "Godot resource pack list changed; refresh the preview and confirm the order again",
      public_details: { action: GODOT_PACK_ORDER_REFRESH_ACTION },
    });
  return { ...game, external: names.map((name) => carriers.get(name)!) };
}

/** 资源头只读顶层类型，坏候选仍进入容器，由成员解析边界报告并保留。 */
export function collect_godot_files(
  game: GodotSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceData {
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
    null,
    fs,
    signal,
    prepared,
  ).data;
}

/** 字体替换只需项目设置及字体映射，不读取脚本和翻译表。 */
export function collect_godot_fonts(
  game: GodotSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  const roots = fs
    .read_dirents(game.root)
    .map((entry) => entry.name)
    .filter((name) => !is_preparation_path(name));
  return collect_game_source_files(
    game.root,
    roots,
    () => ["project.binary"],
    is_godot_font_file,
    fs,
    signal,
    prepared,
  );
}
