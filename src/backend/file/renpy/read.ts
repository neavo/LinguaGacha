import { create_checkpoint } from "./checkpoint";
import assert from "node:assert/strict";
import { create_item } from "../../../domain/item";
import { GAME_METADATA_MEMBER, type GameReadResult } from "../shared/game/format";
import { read_compiled_values } from "./compiled";
import {
  extract_script,
  string_entry,
  type RenpyCandidate,
  type RenpyScript,
  type RenpyString,
} from "./extract";
import { member_digest, read_member, type RenpyMember } from "./member";
import { class_name } from "./pickle";
import type { RenpyFormatMetadata } from "./profile";
import { paragraph_text } from "./python";
import type { PythonSession } from "./python-syntax";
import { script_excluded } from "./script";

export const RENPY_SCRIPT_MEMBER = /^game\/.*\.rpym?c$/u; // 附加原稿与元数据不参与编译分析。

/** 跨成员保留的纯值摘要。完整编译图、代码上下文和写回坐标随成员释放。 */
export type RenpySummary = Readonly<
  Pick<RenpyScript, "digest" | "strings" | "warnings" | "names"> & {
    candidates: readonly Pick<RenpyCandidate, "key" | "text" | "usage">[];
  }
>;
/** 成员失败独立归集，可靠原稿继续参与资产固化。 */
export type RenpyScriptRead = Readonly<
  { name: string } & ({ ok: true; script: RenpySummary } | { ok: false; error: unknown })
>;

/** 字符串表按语言与引擎处理后的原文索引。 */
export const table_key = (language: string | null, original: string): string =>
  JSON.stringify([language, original]);
/** 按成员顺序合并字符串表片段。同键不同文本是冲突，返回首个冲突的原文。 */
export function merge_strings(
  table: Map<string, RenpyString>,
  strings: readonly RenpyString[],
): string | undefined {
  let conflict: string | undefined;
  for (const entry of strings) {
    const key = table_key(entry.language, entry.old),
      prior = table.get(key);
    if (prior && prior.text !== entry.text) conflict ??= entry.old;
    else table.set(key, entry);
  }
  return conflict;
}
/** 菜单百分号与段落标记使用引擎处理后的字符串表键。 */
export function lookup_text(text: string, usage: string, old_substitutions: boolean): string {
  if (usage === "paragraph") return paragraph_text(text);
  return usage === "menu" && old_substitutions ? text.replaceAll("%%", "%") : text;
}
/** 成员无法读取时保留原始原因，提示恢复受支持的编译原稿。 */
export const member_error = (name: string, cause: unknown): Error =>
  new Error("Cannot index Ren'Py member " + name + "; restore a supported original compiled file", {
    cause,
  });

/**
 * 按成员顺序完整提取并只保留纯值摘要。`inspect` 在同一成员图存活期间读取额外事实。
 * 新建导入与离线读取共用此入口。
 */
export async function read_scripts(
  names: readonly string[],
  read_bytes: (name: string) => Promise<Uint8Array>,
  python2: boolean,
  session: PythonSession,
  signal?: AbortSignal,
  inspect?: (name: string, member: RenpyMember) => Promise<void>,
): Promise<RenpyScriptRead[]> {
  const result: RenpyScriptRead[] = [];
  for (const name of names) {
    signal?.throwIfAborted();
    try {
      assert(RENPY_SCRIPT_MEMBER.test(name), "Invalid Ren'Py compiled member: " + name);
      const member = await read_member(await read_bytes(name), python2, signal);
      const script = await extract_script(member, session, signal);
      await inspect?.(name, member);
      result.push({
        name,
        ok: true,
        script: {
          ...script,
          candidates: script.candidates.map(({ key, text, usage }) => ({ key, text, usage })),
        },
      });
    } catch (cause) {
      signal?.throwIfAborted();
      result.push({ name, ok: false, error: member_error(name, cause) });
    } finally {
      session.clear();
    }
  }
  return result;
}

/** 导出只为全表依赖读取字符串表节点，不做候选提取、姓名分析或用途分类。 */
export async function read_strings(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<RenpyString[]> {
  const graph = await read_compiled_values(bytes, signal);
  const excluded = await script_excluded([{ graph }], signal);
  const checkpoint = create_checkpoint(signal);
  const strings: RenpyString[] = [];
  for (const node of graph.nodes) {
    const pause = checkpoint();
    if (pause) await pause;
    if (
      node.kind === "object" &&
      !excluded.has(node) &&
      class_name(node) === "renpy.ast.TranslateString"
    )
      strings.push(string_entry(node));
  }
  return strings;
}

/** 汇总全局字符串表并组装条目：已有基础语言条目拥有译文，避免同一显示文本产生两个写入口。 */
export function renpy_read_results(
  scripts: readonly RenpyScriptRead[],
  metadata: RenpyFormatMetadata,
  metadata_bytes: Uint8Array,
): GameReadResult[] {
  const table = new Map<string, RenpyString>();
  const conflicts = new Map<string, Error>();
  let table_complete = metadata.scripts_incomplete !== true;
  for (const entry of scripts) {
    if (!entry.ok) {
      table_complete = false;
      continue;
    }
    const conflict = merge_strings(table, entry.script.strings);
    if (conflict === undefined) continue;
    table_complete = false;
    conflicts.set(
      entry.name,
      new Error("Conflicting Ren'Py string table: " + entry.name + " / " + conflict),
    );
  }
  // 基础语言表接管显示原文的默认条目，导出身份不依赖此选择。
  const redirected = (text: string, usage: string): boolean =>
    usage !== "string" &&
    usage !== "code" &&
    table.has(table_key(null, lookup_text(text, usage, metadata.old_substitutions)));
  const results: GameReadResult[] = scripts.map((entry): GameReadResult => {
    if (!entry.ok) return entry;
    const conflict = conflicts.get(entry.name);
    if (conflict) return { name: entry.name, ok: false, error: conflict };
    const { name: file, script } = entry;
    const candidates = new Map(script.candidates.map((candidate) => [candidate.key, candidate]));
    /** 字符串表接管正文或姓名时，姓名继续使用独立条目的写入口。 */
    const dialogue_name = (key: string) => {
      const name_key = script.names.get(key);
      if (!name_key) return undefined;
      const dialogue = candidates.get(key)!,
        name = candidates.get(name_key)!;
      return redirected(dialogue.text, dialogue.usage) || redirected(name.text, name.usage)
        ? undefined
        : name;
    };
    const hidden = new Set(
      [...script.names.keys()].flatMap((key) => {
        const name = dialogue_name(key);
        return name ? [name.key] : [];
      }),
    );
    return {
      name: file,
      ok: true,
      read: {
        items: script.candidates
          .filter(
            (candidate) =>
              (table_complete || candidate.usage === "string" || candidate.usage === "code") &&
              !redirected(candidate.text, candidate.usage) &&
              !hidden.has(candidate.key),
          )
          .map((candidate, row) =>
            create_item({
              file_type: "RENPY",
              file_path: file,
              row,
              src: candidate.text,
              name_src: dialogue_name(candidate.key)?.text ?? null,
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
        warnings: script.warnings.map(({ code, ...diagnostic }) => ({
          code,
          rel_path: file,
          diagnostics: [diagnostic],
        })),
      },
    };
  });
  const common_digest = member_digest(metadata_bytes); // 公共条目绑定元数据原始字节，不随读取归一化变化。
  results.push({
    name: GAME_METADATA_MEMBER,
    ok: true,
    read: {
      warnings: [],
      items: (table_complete ? (metadata.common ?? []) : [])
        .filter((original) => !table.has(table_key(null, original)))
        .map((original, row) =>
          create_item({
            file_type: "RENPY",
            file_path: GAME_METADATA_MEMBER,
            row,
            src: original,
            extra_field: {
              renpy: {
                internal_file_path: GAME_METADATA_MEMBER,
                digest: common_digest,
                usage: "common",
                key: original,
              },
            },
          }),
        ),
    },
  });
  return results;
}
