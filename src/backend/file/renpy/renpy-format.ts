import { PythonSession } from "./python-syntax";
import { read_item_name_text, resolve_output_item_name } from "../../../shared/item-name";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Item } from "../../../domain/item";
import {
  GAME_METADATA_MEMBER,
  type GameFiles,
  type GameAssetAdapter,
  type GameOutput,
} from "../shared/game/format";
import { extract_script, type RenpyCandidate, type RenpyString } from "./extract";
import { read_renpy_metadata, type RenpyMetadata } from "./item";
import { member_digest, read_member } from "./member";
import { patch_script, type RenpyChange } from "./patch";
import { read_renpy_format_metadata } from "./profile";
import {
  lookup_text,
  member_error,
  merge_strings,
  read_scripts,
  read_strings,
  renpy_read_results,
  table_key,
} from "./read";
import { RENPY_LANGUAGE_FILE, RENPY_STRINGS_FILE, RENPY_GENERATED_MARKER } from "./generated";
import { encode_python } from "./python";

/** Python `%` 格式记号：`%%`、`%(name)` 与位置转换说明，以及无法构成说明的单独 `%`。 */
const PYTHON_PERCENT_TOKEN =
  /%%|%(?:\([^)]+\))?[#0 +-]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[diouxXeEfFgGcrs]|%/gu;

/** 资产读取与导出都从同一份元数据原始字节开始，公共条目摘要绑定原始字节。 */
async function read_metadata(input: GameFiles) {
  const member = input.get(GAME_METADATA_MEMBER);
  assert(member, "Missing Ren'Py format metadata; import the game again");
  const bytes = await member.async("uint8array");
  return { bytes, metadata: read_renpy_format_metadata(bytes) };
}

/** 一个适配器服务全部 Ren’Py 资产，每次读写操作独享自己的语义状态。 */
export function create_renpy_adapter(): GameAssetAdapter {
  return {
    scope: "asset",
    file_type: "RENPY",
    has_metadata: true,
    internal_path: (item) => read_renpy_metadata(item.extra_field).internal_file_path,
    /** 离线读取复用导入的成员分析与条目组装。 */
    async read_asset(input, signal) {
      const { bytes, metadata } = await read_metadata(input);
      using session = await PythonSession.create();
      const scripts = await read_scripts(
        [...input.keys()].filter((name) => name !== GAME_METADATA_MEMBER),
        (name) => input.get(name)!.async("uint8array"),
        metadata.python_major === 2,
        session,
        signal,
      );
      return renpy_read_results(scripts, metadata, bytes);
    },
    export_files: export_renpy,
  };
}

/**
 * 先验证身份并确定实际改动，只有改动需要时才读取全局字符串表。
 * 只有含已完成条目的成员完整分析，其余成员按原字节输出。
 */
async function* export_renpy(
  input: GameFiles,
  items: readonly Item[],
  signal: AbortSignal,
): AsyncGenerator<GameOutput> {
  const { bytes: metadata_bytes, metadata } = await read_metadata(input);
  const { old_substitutions, common, scripts_incomplete } = metadata;
  const python2 = metadata.python_major === 2;
  const common_digest = member_digest(metadata_bytes);
  const members = [...input].filter(([name]) => name !== GAME_METADATA_MEMBER);
  const groups = new Map<string, { item: Item; location: RenpyMetadata }[]>();
  const commons: Item[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.status !== "PROCESSED") continue;
    const location = read_renpy_metadata(item.extra_field);
    const file = location.internal_file_path;
    const key = JSON.stringify([file, location.key]);
    assert(!seen.has(key), "Duplicate Ren'Py translation coordinate");
    seen.add(key);
    if (file === GAME_METADATA_MEMBER) {
      assert(
        location.digest === common_digest &&
          location.key === item.src &&
          common?.includes(item.src),
        "Ren'Py common original changed",
      );
      if (item.dst !== item.src) commons.push(item);
      continue;
    }
    const group = groups.get(file) ?? [];
    group.push({ item, location });
    groups.set(file, group);
  }

  // 原稿表只读取一次：已分析成员贡献片段，其余成员只读取字符串表节点。
  const fragments = new Map<string, readonly RenpyString[]>();
  let table_read: Promise<ReadonlyMap<string, RenpyString>> | undefined;
  const read_table = async (): Promise<ReadonlyMap<string, RenpyString>> => {
    assert(scripts_incomplete !== true, "Incomplete Ren'Py string table prevents writeback");
    const table = new Map<string, RenpyString>();
    for (const [name, entry] of members) {
      signal.throwIfAborted();
      let strings = fragments.get(name);
      if (!strings) {
        try {
          strings = await read_strings(await entry.async("uint8array"), signal);
        } catch (cause) {
          signal.throwIfAborted();
          throw member_error(name, cause);
        }
      }
      const conflict = merge_strings(table, strings);
      if (conflict !== undefined)
        throw new Error("Conflicting Ren'Py string table: " + name + " / " + conflict);
    }
    fragments.clear(); // 完整表接管字符串，片段只服务首次读取。
    return table;
  };
  /** 本次导出共用一次全表读取及其失败结果。 */
  const table = () => (table_read ??= read_table());
  let languages: Map<string, RenpyString[]> | undefined; // 其他语言条目按原文索引，供改键后的映射。
  const additions = new Map<string, RenpyString>(); // 本轮新增映射与原稿表分别保存。
  /** 新映射同时与原稿和本轮映射核对，避免生成引擎无法加载的重复键。 */
  const add_string = async (entry: RenpyString, member: string) => {
    const key = table_key(entry.language, entry.old);
    const prior = additions.get(key) ?? (await table()).get(key);
    assert(
      !prior || prior.text === entry.text,
      `Conflicting generated Ren'Py string: ${entry.language ?? "None"} / ${entry.old}: ${prior?.text} / ${entry.text} (${member})`,
    );
    if (!prior) additions.set(key, entry);
  };

  using session = await PythonSession.create();
  /** 正文和姓名共用编码与其他语言映射。译文质量由翻译流程负责，这里只保证写回正确。 */
  const write_member = async (
    name: string,
    bytes: Uint8Array,
    group: readonly { item: Item; location: RenpyMetadata }[],
  ): Promise<Uint8Array> => {
    const digest = member_digest(bytes);
    for (const { location } of group)
      assert(location.digest === digest, "Ren'Py original digest changed: " + name);
    const member = await read_member(bytes, python2, signal);
    const script = await extract_script(member, session, signal);
    if (!table_read) fragments.set(name, script.strings);
    const candidates = new Map(script.candidates.map((candidate) => [candidate.key, candidate]));
    const changes: RenpyChange[] = [];
    // 相等比较先于百分号处理与映射登记，原文未变时不会被二次转义。
    const plan = async (candidate: RenpyCandidate, dst: string) => {
      if (dst === candidate.text) return;
      // 旧式替换以整个 store 为映射，只有 `%%` 与命名记号成立，其余 `%` 须转义。
      const text =
        old_substitutions && (candidate.usage === "say" || candidate.usage === "menu")
          ? dst.replace(PYTHON_PERCENT_TOKEN, (token) =>
              token === "%%" || token.startsWith("%(") ? token : "%" + token,
            )
          : dst;
      if (text === candidate.text) return;
      changes.push({ candidate, text });
      if (candidate.usage === "string" || candidate.usage === "code") return;
      if (!languages) {
        const index = new Map<string, RenpyString[]>();
        for (const string of (await table()).values()) {
          if (string.language === null) continue;
          const entries = index.get(string.old) ?? [];
          entries.push(string);
          index.set(string.old, entries);
        }
        languages = index;
      }
      const original_key = lookup_text(candidate.text, candidate.usage, old_substitutions);
      const new_key = lookup_text(text, candidate.usage, old_substitutions);
      for (const string of languages.get(original_key) ?? [])
        await add_string({ language: string.language, old: new_key, text: string.text }, name);
    };
    for (const { item, location } of group) {
      // 条目只按候选身份找回，用途取本次解析结果。提取归属规则不否决已有条目的合法写回。
      const candidate = candidates.get(location.key);
      assert(
        candidate && candidate.text === item.src,
        "Ren'Py candidate changed; reparse the original asset",
      );
      await plan(candidate, item.dst);
      // 旧项目没有姓名字段时只写原有正文。姓名位置按当前成员的原始姓名关系恢复。
      const name_src = read_item_name_text(item.name_src);
      if (!name_src) continue;
      const name_key = script.names.get(candidate.key);
      const speaker = name_key === undefined ? undefined : candidates.get(name_key);
      assert(speaker && speaker.text === name_src, "Ren'Py speaker original changed");
      await plan(speaker, read_item_name_text(resolve_output_item_name(item)));
    }
    return patch_script(member, changes, [], session, signal);
  };

  for (const [name, entry] of members) {
    signal.throwIfAborted();
    const bytes = await entry.async("uint8array");
    const group = groups.get(name);
    if (!group) {
      yield { name, bytes, kind: "original" };
      continue;
    }
    let output: Uint8Array;
    try {
      output = await write_member(name, bytes, group);
    } finally {
      session.clear();
    }
    yield { name, bytes: output, kind: "original" };
  }
  for (const item of commons)
    await add_string({ language: null, old: item.src, text: item.dst }, GAME_METADATA_MEMBER);

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
  yield { name: RENPY_LANGUAGE_FILE, bytes: Buffer.from(language), kind: "generated" };
  yield { name: RENPY_STRINGS_FILE, bytes: Buffer.from(strings), kind: "generated" };
}
