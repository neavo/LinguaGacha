import { PythonSession } from "./python-syntax";
import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { assert_regular_path } from "../source-file-paths";
import {
  collect_game_source_files,
  type GameSourceFiles,
  type PreparedGameFiles,
} from "../shared/game/source-files";
import {
  read_profile,
  collect_common,
  type RenpyProfile,
  type RenpyFormatMetadata,
} from "./profile";
import { read_compiled } from "./compiled";
import { script_codes, audit_code } from "./script";

export const RENPY_GENERATED_MARKER = "# LinguaGacha RenPy generated v1";
export const RENPY_GENERATED_FILES = ["game/zz_lg_language.rpy", "game/zz_lg_strings.rpy"] as const;
export type RenpySource = Readonly<{ root: string; profile: RenpyProfile }>;
/** 目录扫描先识别游戏边界，避免把引擎脚本当成普通来源导入。 */
export function is_renpy_root(input: string, fs: NativeFs): boolean {
  return (
    fs.exists(path.join(input, "game")) &&
    fs.exists(path.join(input, "renpy")) &&
    fs.exists(path.join(input, "lib"))
  );
}
/** EXE、根目录和 game 目录共享同一个来源身份。 */
export async function discover_renpy_source(
  input: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<RenpySource | null> {
  let root = path.resolve(input);
  if (!fs.exists(root)) return null;
  assert_regular_path(root, fs);
  if (fs.stat(root).isFile()) {
    if (path.extname(root).toLowerCase() !== ".exe") return null;
    root = path.dirname(root);
  } else if (path.basename(root).toLowerCase() === "game") root = path.dirname(root);
  if (!is_renpy_root(root, fs)) return null;
  return { root, profile: await read_profile(root, fs, signal) };
}
/** 保留名称必须带产品标记，重导入同时排除源码和其编译产物。 */
export function generated_members(
  files: ReadonlyMap<string, string>,
  read: (name: string) => Uint8Array,
): Set<string> {
  const excluded = new Set<string>();
  for (const name of RENPY_GENERATED_FILES) {
    const actual = [...files.keys()].find((entry) => entry.toLowerCase() === name);
    if (actual) {
      assert(
        actual === name &&
          Buffer.from(read(name))
            .toString("utf8")
            .startsWith(RENPY_GENERATED_MARKER + "\n"),
        "Reserved Ren'Py file conflict: " + actual,
      );
      excluded.add(name);
      excluded.add(name + "c");
    } else
      assert(
        !files.has(name + "c"),
        "Orphaned LinguaGacha compiled resource; restore its generated source: " + name,
      );
  }
  return excluded;
}
/** 只固化编译脚本和离线生成所需的公共字符串，素材留在游戏目录。 */
export async function collect_renpy_files(
  game: RenpySource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): Promise<GameSourceFiles> {
  using session = await PythonSession.create();
  const result = collect_game_source_files(
    game.root,
    ["game"],
    (files, read) => {
      const generated = generated_members(files, read);
      return [...files.keys()]
        .filter(
          (name) =>
            name.startsWith("game/") &&
            /\.rpym?c$/u.test(name) &&
            !/^game\/(?:cache|saves)\//u.test(name) &&
            !generated.has(name),
        )
        .sort();
    },
    () => false,
    fs,
    signal,
    prepared,
  );
  assert(
    result.data.size > 0,
    "Ren'Py game contains no compiled scripts; start the original game once before importing",
  );
  const assignments = new Set<boolean | null>();
  let include_layout = false;
  for (const [member, bytes] of result.data) {
    signal?.throwIfAborted();
    for (const code of script_codes({ slots: read_compiled(bytes) })) {
      const facts = await audit_code(
        code,
        member,
        session,
        !game.profile.version.startsWith("8."),
        signal,
      );
      if (facts.references.some((entry) => entry.startsWith("layout."))) include_layout = true;
      if (facts.bare_references.some((name) => name === "config" || name === "renpy.config"))
        assignments.add(null);
      const references = facts.references.filter(
        (entry) =>
          entry === "config.old_substitutions" || entry === "renpy.config.old_substitutions",
      );
      if (!references.length) continue;
      const values = facts.assignments.filter(
        (entry) => entry.target === "config.old_substitutions",
      );
      if (code.phase !== "init" || values.length !== references.length) assignments.add(null);
      for (const entry of values)
        assignments.add(
          entry.root && entry.operation === "=" && typeof entry.value === "boolean"
            ? entry.value
            : null,
        );
    }
  }
  const old_substitutions =
    assignments.size === 0
      ? game.profile.old_substitutions
      : assignments.size === 1
        ? [...assignments][0]!
        : null;
  const metadata: RenpyFormatMetadata = {
    schema: "linguagacha-renpy-1",
    profile: { ...game.profile, old_substitutions },
    common: await collect_common(game.root, fs, signal, include_layout, session),
  };
  return { ...result, metadata: Buffer.from(JSON.stringify(metadata)) };
}
