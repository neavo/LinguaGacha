import { source_diagnostic, type SourceDiagnostic } from "../shared/game/preparation";
import { PythonSyntaxError, PythonSession, python_value, type PythonValue } from "./python-syntax";
import assert from "node:assert/strict";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { NativeFs } from "../../../native/native-fs";
import { assert_regular_path } from "../source-file-paths";
import {
  collect_game_source_files,
  type GameImport,
  type GameImportSources,
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
import { analyze_code } from "./script";
import { generated_members } from "./generated";
import type { RenpyMember } from "./member";
import { PythonDecodeError } from "./python";
import { RENPY_SCRIPT_MEMBER, read_scripts, renpy_read_results } from "./read";
import {
  order_initialization,
  RENPY_COMPAT_PRIORITY,
  RENPY_COMPAT_SCRIPT,
  type RenpyInitPosition,
} from "./initialization";

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
const SUBSTITUTION_TARGETS = new Set([
  "config.old_substitutions",
  "renpy.config.old_substitutions",
]);
const VERSION_TARGETS = new Set(["config.script_version", "renpy.config.script_version"]);
/** 百分号设置的一次静态声明。`default` 表示该位置的值无法静态求值，按默认回退。 */
type SubstitutionSetting = RenpyInitPosition & { value: boolean | "default" };

/** `00compat` 的 `_set_script_version`：脚本兼容版本落在该区间时关闭旧式替换。 */
function compat_disables_substitutions(version: PythonValue): boolean {
  if (!Array.isArray(version) || !version.every((part) => typeof part === "number")) return false;
  // Python 元组比较：逐项比较，前缀相同时较短者更小。
  const compare = (other: readonly number[]) => {
    for (let index = 0; index < Math.min(version.length, other.length); index++)
      if (version[index] !== other[index]) return (version[index] as number) - other[index]!;
    return version.length - other.length;
  };
  return compare([6, 12, 2]) > 0 && compare([6, 13, 8]) <= 0;
}

/**
 * 读取当前成员中初始化根层的百分号设置，以及是否使用旧布局。
 * 槽位分别提取并须一致；声明不可靠时返回 `null`，由调用方整体回退到默认值。
 */
async function read_settings(
  member: RenpyMember,
  file: string,
  session: PythonSession,
  signal?: AbortSignal,
): Promise<{ settings: SubstitutionSetting[] | null; layout: boolean }> {
  let layout = false,
    reliable = true;
  let settings: SubstitutionSetting[] | undefined;
  for (const slot of member.slots) {
    const current: SubstitutionSetting[] = [];
    for (const code of member.codes) {
      if (code.slot !== slot.slot) continue;
      // 只有主脚本的初始化代码进入引擎初始化顺序，显式加载的模块与其他语言块不提供静态设置。
      const initializing = code.phase === "init" && !code.translated && file.endsWith(".rpyc");
      let facts;
      try {
        facts = await analyze_code(code, session, member.python2, signal);
      } catch (error) {
        if (!(error instanceof PythonSyntaxError)) throw error;
        if (initializing) reliable = false; // 语法诊断已由提取报告。
        continue;
      }
      if (facts.references.some((entry) => entry.startsWith("layout."))) layout = true;
      if (!initializing) continue;
      for (const assignment of facts.assignments) {
        if (!assignment.root) continue;
        const substitution = SUBSTITUTION_TARGETS.has(assignment.target);
        if (!substitution && !VERSION_TARGETS.has(assignment.target)) continue;
        if (code.priority === null) {
          reliable = false;
          continue;
        }
        const position = { file, early: code.early, priority: code.priority };
        const literal = assignment.operation === "=" ? assignment.value : undefined;
        if (substitution)
          current.push({ ...position, value: typeof literal === "boolean" ? literal : "default" });
        // 区间外的版本不重置既有设置，与引擎兼容函数一致。
        else if (compat_disables_substitutions(literal))
          current.push({ ...position, value: false });
      }
    }
    if (settings && !isDeepStrictEqual(settings, current)) reliable = false;
    settings ??= current;
  }
  return { settings: reliable ? (settings ?? []) : null, layout };
}

/** 脚本兼容版本文件按引擎的 `ast.literal_eval` 读取，内容无法确定时不提供兼容设置。 */
async function read_script_version(
  bytes: Uint8Array | undefined,
  session: PythonSession,
  signal?: AbortSignal,
): Promise<PythonValue> {
  if (!bytes) return undefined;
  try {
    return await session.read(
      { source: Buffer.from(bytes).toString("utf8"), mode: "eval" },
      ({ root }) => python_value(root.namedChildren[0] ?? null),
      signal,
    );
  } catch (error) {
    if (error instanceof PythonSyntaxError || error instanceof PythonDecodeError) return undefined;
    throw error;
  }
}

/**
 * 新建导入的联合分析：同一次成员提取同时取得条目、字符串表片段和元数据事实，
 * 再按全局字符串表组装条目。结果只绑定本次固化的原字节与元数据。
 */
export async function prepare_renpy_import(
  game: RenpySource,
  sources: GameImportSources,
  fs: NativeFs,
  signal?: AbortSignal,
  report?: (diagnostic: SourceDiagnostic) => void,
): Promise<GameImport> {
  using session = await PythonSession.create();
  const settings: SubstitutionSetting[] = [];
  let reliable = sources.complete,
    include_layout = false;
  const scripts = await read_scripts(
    [...sources.data.keys()].filter((name) => RENPY_SCRIPT_MEMBER.test(name)),
    async (name) => sources.data.get(name)!,
    game.profile.python_major === 2,
    session,
    signal,
    async (name, member) => {
      const facts = await read_settings(member, name, session, signal);
      if (facts.layout) include_layout = true;
      if (facts.settings) settings.push(...facts.settings);
      else reliable = false;
    },
  );
  if (scripts.some((entry) => !entry.ok)) reliable = false;
  // 兼容设置在 `init -1000` 读取版本文件，与游戏声明按初始化顺序共同决定最终值。
  const compat = compat_disables_substitutions(
    await read_script_version(sources.data.get("game/script_version.txt"), session, signal),
  );
  const fallback = compat ? false : game.profile.old_substitutions;
  let old_substitutions = fallback;
  if (reliable) {
    const compat_setting: SubstitutionSetting = {
      file: RENPY_COMPAT_SCRIPT,
      early: false,
      priority: RENPY_COMPAT_PRIORITY,
      value: false,
    };
    const declared = compat ? [compat_setting, ...settings] : settings;
    old_substitutions = game.profile.old_substitutions;
    for (const setting of order_initialization(declared, game.profile, new Set(sources.files)))
      old_substitutions = setting.value === "default" ? fallback : setting.value;
  }
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
  const bytes = Buffer.from(JSON.stringify(metadata));
  return { metadata: bytes, read: renpy_read_results(scripts, metadata, bytes) };
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
