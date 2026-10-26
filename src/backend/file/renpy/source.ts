import { source_diagnostic, type SourceDiagnostic } from "../shared/game/preparation";
import { PythonSession } from "./python-syntax";
import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { assert_regular_path } from "../source-file-paths";
import {
  collect_game_source_files,
  type GameSourceData,
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
import { generated_members } from "./generated";

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
  using session = await PythonSession.create();
  return { root, profile: await read_profile(root, fs, signal, session) };
}
/** 收集固化所需的编译脚本。 */
export function collect_renpy_files(
  game: RenpySource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceData {
  const { data } = collect_game_source_files(
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
    null,
    fs,
    signal,
    prepared,
  );
  assert(
    data.size > 0,
    "Ren'Py game contains no compiled scripts; start the original game once before importing",
  );
  return data;
}
/** 导入使用已读定的原件构建离线语义，字体收集不触发脚本分析。 */
export async function build_renpy_metadata(
  game: RenpySource,
  sources: Readonly<{ data: GameSourceData; complete: boolean }>,
  fs: NativeFs,
  signal?: AbortSignal,
  report?: (diagnostic: SourceDiagnostic) => void,
): Promise<Uint8Array> {
  const assignments = new Set<boolean | null>(sources.complete ? [] : [null]);
  let include_layout = false;
  for (const [member, bytes] of sources.data) {
    signal?.throwIfAborted();
    using session = await PythonSession.create();
    try {
      for (const code of script_codes({ slots: read_compiled(bytes) })) {
        const facts = await audit_code(
          code,
          member,
          session,
          game.profile.python_major === 2,
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
    } catch (error) {
      signal?.throwIfAborted();
      assignments.add(null);
      report?.(source_diagnostic("archive", error, member));
    }
  }
  const old_substitutions =
    assignments.size === 0
      ? game.profile.old_substitutions
      : assignments.size === 1
        ? [...assignments][0]!
        : null;
  using session = await PythonSession.create();
  let common: string[] | null;
  try {
    // 缺失脚本可能引用旧布局，无法确认公共字符串的收集范围。
    common = sources.complete
      ? await collect_common(game.root, fs, signal, include_layout, session)
      : null;
  } catch (error) {
    signal?.throwIfAborted();
    common = null;
    report?.(source_diagnostic("archive", error, "renpy/common"));
  }
  const metadata: RenpyFormatMetadata = {
    schema: "linguagacha-renpy-1",
    engine_version: game.profile.version,
    python_major: game.profile.python_major,
    old_substitutions,
    common,
    ...(sources.complete ? {} : { scripts_incomplete: true as const }),
  };
  return Buffer.from(JSON.stringify(metadata));
}

/** 字体工具只读取有效字体及生成资源归属标记。 */
export function collect_renpy_fonts(
  game: RenpySource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  return collect_game_source_files(
    game.root,
    ["game"],
    (files, read) => {
      generated_members(files, read);
      return [];
    },
    (name) => /^game\/(?!cache\/|saves\/).*\.(?:ttf|otf)$/iu.test(name),
    fs,
    signal,
    prepared,
  );
}
