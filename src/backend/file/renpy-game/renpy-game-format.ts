import { PythonSession } from "./python-syntax";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { create_item } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { GAME_METADATA_MEMBER, type GameFormatAdapter } from "../shared/game/format";
import {
  extract_script,
  patch_script,
  type RenpyScript,
  type RenpyChange,
  type RenpyString,
  type RenpyCandidate,
} from "./extract";
import { read_renpy_metadata } from "./item";
import { RENPY_GENERATED_FILES, RENPY_GENERATED_MARKER } from "./source";
import { encode_python, paragraph_text } from "./python";
import { scan_renpy_boundaries } from "../../../shared/text/renpy-boundaries";

/** 导出只保留原字节和候选索引。完整 Pickle 图按成员释放。 */
type IndexedScript = Pick<RenpyScript, "bytes" | "digest" | "warnings"> & {
  candidates: ReadonlyMap<string, RenpyCandidate>;
};

/** 一个处理器拥有一次资产的解析和写回计划，不向其他资产共享可变状态。 */
export function create_renpy_adapter(): GameFormatAdapter {
  return {
    file_type: "RENPY_NATIVE",
    has_metadata: true,
    internal_path: (item) => read_renpy_metadata(item.extra_field).internal_file_path,
    /** 先建立全资产字符串表，成员提取与导出共用同一个索引。 */
    async create_members(files) {
      using session = await PythonSession.create();
      const member = files.get(GAME_METADATA_MEMBER);
      assert(member, "Missing Ren'Py format metadata; import the game again");
      const metadata_bytes = await member.async("uint8array");
      const metadata = read_json_record(
        JSON.parse(Buffer.from(metadata_bytes).toString("utf8")) as unknown,
      );
      assert(metadata["schema"] === "linguagacha-renpy-1", "Unknown Ren'Py metadata schema");
      const profile = read_json_record(metadata["profile"]);
      assert(
        profile["old_substitutions"] === null || typeof profile["old_substitutions"] === "boolean",
        "Invalid Ren'Py text semantics",
      );
      const common = metadata["common"];
      assert(
        Array.isArray(common) && common.every((entry) => typeof entry === "string"),
        "Invalid Ren'Py common strings",
      );
      const common_digest = createHash("sha256").update(metadata_bytes).digest("hex");
      const scripts = new Map<string, IndexedScript>(),
        table = new Map<string, RenpyString>();
      const table_key = (language: string | null, original: string) =>
        JSON.stringify([language, original]);
      for (const [name, entry] of files) {
        if (name === GAME_METADATA_MEMBER) continue;
        assert(/^game\/.*\.rpym?c$/u.test(name), "Invalid Ren'Py compiled member: " + name);
        let script: RenpyScript;
        try {
          script = await extract_script(
            await entry.async("uint8array"),
            !String(profile["version"]).startsWith("8."),
            session,
          );
        } catch (cause) {
          throw new Error(
            "Cannot index Ren'Py member " + name + "; restore a supported original compiled file",
            { cause },
          );
        }
        scripts.set(name, {
          bytes: script.bytes,
          digest: script.digest,
          warnings: script.warnings,
          candidates: new Map(script.candidates.map((candidate) => [candidate.key, candidate])),
        });
        for (const string of script.strings) {
          const key = table_key(string.language, string.old),
            prior = table.get(key);
          assert(
            !prior || prior.text === string.text,
            "Conflicting Ren'Py string table: " + name + " / " + string.old,
          );
          table.set(key, string);
        }
      }
      const rendered = new Map<string, Buffer>(); // 全部译文校验成功后才允许共享层写出。
      /** 菜单百分号与段落标记使用引擎处理后的字符串表键。 */
      const lookup_text = (text: string, usage: string): string =>
        usage === "paragraph"
          ? paragraph_text(text)
          : usage === "menu" && profile["old_substitutions"] === true
            ? text.replaceAll("%%", "%")
            : text;
      const redirected = (text: string, usage: string): boolean =>
        usage !== "string" &&
        usage !== "code" &&
        table.has(table_key(null, lookup_text(text, usage)));
      return {
        /** 已有基础语言条目拥有译文，避免同一显示文本产生两个写入口。 */
        async read_file(_content, file) {
          if (file === GAME_METADATA_MEMBER)
            return {
              warnings: [],
              items: (common as string[])
                .filter((original) => !table.has(table_key(null, original)))
                .map((original, row) =>
                  create_item({
                    file_type: "RENPY_NATIVE",
                    file_path: file,
                    row,
                    src: original,
                    extra_field: {
                      renpy_game: {
                        internal_file_path: file,
                        digest: common_digest,
                        usage: "common",
                        key: original,
                        coordinates: [],
                      },
                    },
                  }),
                ),
            };
          const script = scripts.get(file)!;
          return {
            items: [...script.candidates.values()]
              .filter((candidate) => !redirected(candidate.text, candidate.usage))
              .map((candidate, row) =>
                create_item({
                  file_type: "RENPY_NATIVE",
                  file_path: file,
                  row,
                  src: candidate.text,
                  status: candidate.usage === "code" ? "RULE_SKIPPED" : "NONE",
                  extra_field: {
                    renpy_game: {
                      internal_file_path: file,
                      digest: script.digest,
                      usage: candidate.usage,
                      key: candidate.key,
                      coordinates: candidate.coordinates.map((coordinate) => ({ ...coordinate })),
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
        /** 先处理跨成员冲突，再编译每个发生变化的成员。 */
        async prepare_export(items) {
          using session = await PythonSession.create();
          rendered.clear();
          const additions = new Map<string, RenpyString>(),
            changes = new Map<string, RenpyChange[]>(),
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
          for (const item of items) {
            if (item.status !== "PROCESSED") continue;
            const location = read_renpy_metadata(item.extra_field);
            const key = JSON.stringify([location.internal_file_path, location.key]);
            assert(!seen.has(key), "Duplicate Ren'Py translation coordinate");
            seen.add(key);
            assert(
              !item.dst.includes("\0"),
              "Ren'Py translation contains NUL: " + location.internal_file_path,
            );
            if (location.usage !== "code") {
              let at = 0;
              for (const boundary of scan_renpy_boundaries(item.dst)) {
                assert(
                  !/[[{]/u.test(item.dst.slice(at, boundary.index)),
                  "Unclosed Ren'Py interpolation or tag: " + location.internal_file_path,
                );
                at = boundary.index + boundary.value.length;
              }
              assert(
                !/[[{]/u.test(item.dst.slice(at)),
                "Unclosed Ren'Py interpolation or tag: " + location.internal_file_path,
              );
            }
            const tags = (value: string) =>
              scan_renpy_boundaries(value)
                .filter((entry) => entry.value.startsWith("{#"))
                .map((entry) => entry.value);
            assert.deepEqual(
              tags(item.dst),
              tags(item.src),
              "Ren'Py context tags changed: " + location.internal_file_path,
            );
            if (location.usage === "common") {
              assert(
                location.internal_file_path === GAME_METADATA_MEMBER &&
                  location.digest === common_digest &&
                  location.key === item.src &&
                  common.includes(item.src),
                "Ren'Py common original changed",
              );
              if (item.dst !== item.src)
                add_string({ language: null, old: item.src, text: item.dst });
              continue;
            }
            const script = scripts.get(location.internal_file_path);
            assert(
              script && script.digest === location.digest,
              "Ren'Py original digest changed: " + location.internal_file_path,
            );
            const candidate = script.candidates.get(location.key);
            assert(
              candidate && candidate.text === item.src && candidate.usage === location.usage,
              "Ren'Py candidate changed; reparse the original asset",
            );
            assert(
              !redirected(candidate.text, candidate.usage),
              "Translate the existing base-language string entry: " + item.src,
            );
            assert.deepEqual(
              candidate.coordinates,
              location.coordinates,
              "Ren'Py write group changed",
            );
            if (item.dst === item.src) continue;
            let translation = item.dst;
            if (candidate.usage === "say" || candidate.usage === "menu") {
              assert(
                profile["old_substitutions"] !== null || !translation.includes("%"),
                "Unknown Ren'Py percent semantics",
              );
              if (profile["old_substitutions"] === true)
                translation = translation.replace(
                  /%%|%\([^)]+\)[#0 +-]*\d*(?:\.\d+)?[diouxXeEfFgGcrs]|%/gu,
                  (token) => (token === "%" ? "%%" : token),
                );
            }
            const entry = changes.get(location.internal_file_path) ?? [];
            entry.push({ candidate, text: translation });
            changes.set(location.internal_file_path, entry);
            if (candidate.usage !== "string") {
              const original_key = lookup_text(item.src, candidate.usage);
              const new_key = lookup_text(translation, candidate.usage);
              for (const string of table.values())
                if (string.language !== null && string.old === original_key)
                  add_string({ language: string.language, old: new_key, text: string.text });
            }
          }
          // 所有确认译文先成功应用，再交给共享层落盘。
          for (const [file, entries] of changes)
            rendered.set(
              file,
              await patch_script(
                await extract_script(
                  scripts.get(file)!.bytes,
                  !String(profile["version"]).startsWith("8."),
                  session,
                ),
                entries,
                false,
                session,
              ),
            );
          let strings = RENPY_GENERATED_MARKER + "\n";
          for (const entry of additions.values()) {
            assert(
              entry.language === null || /^[A-Za-z_]\w*$/u.test(entry.language),
              "Invalid Ren'Py language identifier",
            );
            strings += `\ntranslate ${entry.language ?? "None"} strings:\n    old ${encode_python(entry.old)}\n    new ${encode_python(entry.text)}\n`;
          }
          const id = randomUUID();
          const language = `${RENPY_GENERATED_MARKER}\ninit 1999 python:\n    if getattr(persistent, '_linguagacha_base_language', None) != '${id}':\n        persistent._linguagacha_base_language = '${id}'\n        _preferences.language = None\n    config.language = None\n`;
          return new Map([
            [RENPY_GENERATED_FILES[0], Buffer.from(language)],
            [RENPY_GENERATED_FILES[1], Buffer.from(strings)],
          ]);
        },
        /** 没有写回计划的成员直接使用原字节。 */
        async render(content, file) {
          return rendered.get(file) ?? content;
        },
      };
    },
  };
}
