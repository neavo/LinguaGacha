import { PythonSession } from "./python-syntax";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { create_item, type Item } from "../../../domain/item";
import { GAME_METADATA_MEMBER, type GameFormatAdapter } from "../shared/game/format";
import {
  extract_script,
  patch_script,
  type RenpyScript,
  type RenpyChange,
  type RenpyString,
  type RenpyCandidate,
} from "./extract";
import { read_renpy_metadata, type RenpyMetadata } from "./item";
import { read_renpy_format_metadata } from "./profile";
import { RENPY_LANGUAGE_FILE, RENPY_STRINGS_FILE, RENPY_GENERATED_MARKER } from "./generated";
import { encode_python, paragraph_text } from "./python";
import { read_compiled } from "./compiled";
import { scan_renpy_boundaries } from "../../../shared/text/renpy-boundaries";

/** Python `%` 格式记号：`%%`、`%(name)` 与位置转换说明，以及无法构成说明的单独 `%`。 */
const PYTHON_PERCENT_TOKEN =
  /%%|%(?:\([^)]+\))?[#0 +-]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[diouxXeEfFgGcrs]|%/gu;
/** 完整记号序列，包括字面百分号 `%%`。命名记号按名称取参，按多重集比较。 */
function percent_tokens(text: string): string[] {
  const tokens = text.match(PYTHON_PERCENT_TOKEN) ?? [];
  return tokens.some((token) => token.startsWith("%(")) ? tokens.sort() : tokens;
}
/** 插值和文本标签必须闭合，`{#…}` 是引擎查表上下文，不能增删。 */
function check_text(item: Item, file: string, usage: RenpyMetadata["usage"]): void {
  if (usage !== "code") {
    let at = 0;
    for (const boundary of scan_renpy_boundaries(item.dst)) {
      assert(
        !/[[{]/u.test(item.dst.slice(at, boundary.index)),
        "Unclosed Ren'Py interpolation or tag: " + file,
      );
      at = boundary.index + boundary.value.length;
    }
    assert(!/[[{]/u.test(item.dst.slice(at)), "Unclosed Ren'Py interpolation or tag: " + file);
  }
  const tags = (value: string) =>
    scan_renpy_boundaries(value)
      .filter((entry) => entry.value.startsWith("{#"))
      .map((entry) => entry.value);
  assert.deepEqual(tags(item.dst), tags(item.src), "Ren'Py context tags changed: " + file);
}

/** 导出只保留候选索引。完整 Pickle 图按成员释放。 */
type IndexedScript = Pick<RenpyScript, "digest" | "warnings" | "extraction_complete"> & {
  candidates: ReadonlyMap<string, RenpyCandidate>;
};

/** 一个处理器拥有一次资产的解析和写回计划，不向其他资产共享可变状态。 */
export function create_renpy_adapter(): GameFormatAdapter {
  return {
    file_type: "RENPY",
    has_metadata: true,
    internal_path: (item) => read_renpy_metadata(item.extra_field).internal_file_path,
    /** 读取建立全局字符串表，写回按实际候选决定索引范围。 */
    async create_members(files) {
      const member = files.get(GAME_METADATA_MEMBER);
      assert(member, "Missing Ren'Py format metadata; import the game again");
      const metadata_bytes = await member.async("uint8array");
      const { python_major, old_substitutions, common, scripts_incomplete } =
        read_renpy_format_metadata(metadata_bytes);
      const python2 = python_major === 2;
      const common_digest = createHash("sha256").update(metadata_bytes).digest("hex");
      const scripts = new Map<string, IndexedScript>(),
        table = new Map<string, RenpyString>();
      const failures = new Map<string, unknown>();
      let table_complete = scripts_incomplete !== true;
      const table_key = (language: string | null, original: string) =>
        JSON.stringify([language, original]);
      let all_indexed = false;
      // 同一操作复用索引。仅代码写回无需解释其他脚本的字符串表。
      const index_scripts = async (names?: Iterable<string>): Promise<void> => {
        if (names === undefined && all_indexed) return;
        for (const name of names ?? files.keys()) {
          if (name === GAME_METADATA_MEMBER || scripts.has(name) || failures.has(name)) continue;
          const entry = files.get(name);
          assert(entry, "Missing Ren'Py compiled member: " + name);
          assert(/^game\/.*\.rpym?c$/u.test(name), "Invalid Ren'Py compiled member: " + name);
          using session = await PythonSession.create();
          let script: RenpyScript;
          try {
            script = await extract_script(await entry.async("uint8array"), python2, session);
          } catch (cause) {
            failures.set(
              name,
              new Error(
                "Cannot index Ren'Py member " +
                  name +
                  "; restore a supported original compiled file",
                { cause },
              ),
            );
            table_complete = false;
            continue;
          }
          scripts.set(name, {
            digest: script.digest,
            warnings: script.warnings,
            extraction_complete: script.extraction_complete,
            candidates: new Map(script.candidates.map((candidate) => [candidate.key, candidate])),
          });
          for (const string of script.strings) {
            const key = table_key(string.language, string.old),
              prior = table.get(key);
            if (prior && prior.text !== string.text) {
              table_complete = false;
              failures.set(
                name,
                new Error("Conflicting Ren'Py string table: " + name + " / " + string.old),
              );
              continue;
            }
            table.set(key, string);
          }
        }
        if (names === undefined) all_indexed = true;
      };
      const changes = new Map<string, RenpyChange[]>(); // 处理器只服务一次资产操作。
      /** 菜单百分号与段落标记使用引擎处理后的字符串表键。 */
      const lookup_text = (text: string, usage: string): string =>
        usage === "paragraph"
          ? paragraph_text(text)
          : usage === "menu" && old_substitutions === true
            ? text.replaceAll("%%", "%")
            : text;
      const redirected = (text: string, usage: string): boolean =>
        usage !== "string" &&
        usage !== "code" &&
        table.has(table_key(null, lookup_text(text, usage)));
      return {
        /** 已有基础语言条目拥有译文，避免同一显示文本产生两个写入口。 */
        async read_file(_content, file) {
          await index_scripts();
          if (failures.has(file)) throw failures.get(file);
          if (file === GAME_METADATA_MEMBER)
            return {
              extraction_complete: table_complete && common !== null,
              warnings: [],
              items: (table_complete ? (common ?? []) : [])
                .filter((original) => !table.has(table_key(null, original)))
                .map((original, row) =>
                  create_item({
                    file_type: "RENPY",
                    file_path: file,
                    row,
                    src: original,
                    extra_field: {
                      renpy: {
                        internal_file_path: file,
                        digest: common_digest,
                        usage: "common",
                        key: original,
                      },
                    },
                  }),
                ),
            };
          const script = scripts.get(file)!;
          return {
            extraction_complete: script.extraction_complete && table_complete,
            items: [...script.candidates.values()]
              .filter(
                (candidate) =>
                  table_complete || candidate.usage === "string" || candidate.usage === "code",
              )
              .filter((candidate) => !redirected(candidate.text, candidate.usage))
              .map((candidate, row) =>
                create_item({
                  file_type: "RENPY",
                  file_path: file,
                  row,
                  src: candidate.text,
                  status: candidate.usage === "code" ? "RULE_SKIPPED" : "NONE",
                  extra_field: {
                    renpy: {
                      internal_file_path: file,
                      digest: script.digest,
                      usage: candidate.usage,
                      key: candidate.key,
                    },
                  },
                }),
              ),
            warnings: script.warnings.map((diagnostic) => ({
              code: "script_syntax_error" as const,
              rel_path: file,
              diagnostics: [diagnostic],
            })),
          };
        },
        /** 校验全部条目并建立跨成员写回计划。 */
        async prepare_export(items) {
          const translated = items.filter((item) => item.status === "PROCESSED");
          await index_scripts(
            translated.map((item) => read_renpy_metadata(item.extra_field).internal_file_path),
          );
          // 使用本次解析的用途，不能凭持久化条目的旧用途跳过真实依赖。
          const needs_table = translated.some((item) => {
            const location = read_renpy_metadata(item.extra_field);
            return (
              location.internal_file_path === GAME_METADATA_MEMBER ||
              scripts.get(location.internal_file_path)?.candidates.get(location.key)?.usage !==
                "code"
            );
          });
          if (needs_table) {
            await index_scripts();
            assert(table_complete, "Incomplete Ren'Py string table prevents writeback");
          }
          const languages = new Map<string, RenpyString[]>();
          if (needs_table)
            for (const string of table.values()) {
              if (string.language === null) continue;
              const entries = languages.get(string.old) ?? [];
              entries.push(string);
              languages.set(string.old, entries);
            }
          const additions = new Map<string, RenpyString>(),
            seen = new Set<string>();
          const add_string = (entry: RenpyString) => {
            const key = table_key(entry.language, entry.old),
              prior = additions.get(key) ?? table.get(key);
            assert(
              !prior || prior.text === entry.text,
              "Conflicting generated Ren'Py string: " + entry.old,
            );
            if (!prior) additions.set(key, entry);
          };
          for (const item of translated) {
            const location = read_renpy_metadata(item.extra_field);
            const file = location.internal_file_path;
            const key = JSON.stringify([file, location.key]);
            assert(!seen.has(key), "Duplicate Ren'Py translation coordinate");
            seen.add(key);
            assert(!item.dst.includes("\0"), "Ren'Py translation contains NUL: " + file);
            if (file === GAME_METADATA_MEMBER) {
              assert(
                location.digest === common_digest &&
                  location.key === item.src &&
                  common?.includes(item.src),
                "Ren'Py common original changed",
              );
              check_text(item, file, "common");
              if (item.dst !== item.src)
                add_string({ language: null, old: item.src, text: item.dst });
              continue;
            }
            const script = scripts.get(file);
            assert(
              script && script.digest === location.digest,
              "Ren'Py original digest changed: " + file,
            );
            // 条目只按候选身份找回。后续检查使用本次解析的用途，不使用条目保存的用途。
            const candidate = script.candidates.get(location.key);
            assert(
              candidate && candidate.text === item.src,
              "Ren'Py candidate changed; reparse the original asset",
            );
            assert(
              !redirected(candidate.text, candidate.usage),
              "Translate the existing base-language string entry: " + item.src,
            );
            check_text(item, file, candidate.usage);
            // `%` 左操作数在运行时格式化，记号不一致会使游戏抛出异常。
            if (candidate.percent)
              assert.deepEqual(
                percent_tokens(item.dst),
                percent_tokens(item.src),
                "Ren'Py percent format changed: " + file + " / " + item.src,
              );
            if (item.dst === item.src) continue;
            let translation = item.dst;
            if (candidate.usage === "say" || candidate.usage === "menu") {
              assert(
                old_substitutions !== null || !translation.includes("%"),
                "Unknown Ren'Py percent semantics",
              );
              // 旧式替换以整个 store 为映射，只有 `%%` 与命名记号成立，其余 `%` 须转义。
              if (old_substitutions === true)
                translation = translation.replace(PYTHON_PERCENT_TOKEN, (token) =>
                  token === "%%" || token.startsWith("%(") ? token : "%" + token,
                );
            }
            const entry = changes.get(file) ?? [];
            entry.push({ candidate, text: translation });
            changes.set(file, entry);
            if (candidate.usage !== "string" && candidate.usage !== "code") {
              const original_key = lookup_text(item.src, candidate.usage);
              const new_key = lookup_text(translation, candidate.usage);
              for (const string of languages.get(original_key) ?? [])
                add_string({ language: string.language, old: new_key, text: string.text });
            }
          }
          let strings = RENPY_GENERATED_MARKER + "\n";
          // old/new 已使用 Unicode 语义，6.x 还会自动添加 u 前缀，因此生成时去掉 Python 前缀。
          for (const entry of additions.values()) {
            assert(
              entry.language === null || /^[A-Za-z_]\w*$/u.test(entry.language),
              "Invalid Ren'Py language identifier",
            );
            strings += `\ntranslate ${entry.language ?? "None"} strings:\n    old ${encode_python(entry.old).slice(1)}\n    new ${encode_python(entry.text).slice(1)}\n`;
          }
          const id = randomUUID();
          const language = `${RENPY_GENERATED_MARKER}\ninit 1999 python:\n    if getattr(persistent, '_linguagacha_base_language', None) != '${id}':\n        persistent._linguagacha_base_language = '${id}'\n        _preferences.language = None\n    config.language = None\n`;
          return new Map([
            [RENPY_LANGUAGE_FILE, Buffer.from(language)],
            [RENPY_STRINGS_FILE, Buffer.from(strings)],
          ]);
        },
        /** 没有写回计划的成员直接使用原字节。 */
        async render(content, file) {
          const entries = changes.get(file);
          if (!entries) return content;
          using session = await PythonSession.create();
          const bytes = Buffer.from(content);
          return await patch_script(
            { bytes, slots: read_compiled(bytes), python2 },
            entries,
            [],
            session,
          );
        },
      };
    },
  };
}
