import { godot_member_kind } from "./member";
import type { GodotLocation } from "./item";
import { read_gdsc, type TokenKind } from "./gdsc";
import { read_scene } from "./scene";
import { read_resource } from "./resource";
import {
  read_messages,
  read_translation,
  translation_slot,
  plan_translation_locale,
} from "./translation";
import { read_source } from "./gdscript";
import { all_values, type Value } from "./variant";
import { read_po } from "./po";
export type TextEntry = Readonly<{
  location: GodotLocation;
  original: string;
  eligible: boolean; // true 对应产品默认状态 NONE，false 对应 RULE_SKIPPED，仍可人工放行。
}>;
/*
 * 首期候选漏斗：
 * 1. 噪声不产生条目：私有区伪字符、资源 URI、颜色值，以及去掉格式占位符和 BBCode 后没有文字的字符串。
 * 2. 已是语言表消息键的字面量交给语言表翻译，字面量本身规则跳过。
 * 3. 显示属性赋值、显示类调用参数默认翻译。
 * 4. 字典键、比较、下标、注解、代码属性赋值、代码类调用参数和无空白的 ASCII 标记规则跳过。
 * 5. 其余含空白或非 ASCII 字符的字符串默认翻译，剩余字符串规则跳过。
 */
const NOISE = /\p{Co}|^(?:res|user|uid):\/\/|^#[0-9a-f]{3,8}$/iu;
const MARKUP = /%[-+0*]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[scdoxXfv%]|\{[^{}]*\}|\[[^[\]]*\]/gu; // Godot 格式占位符与 BBCode 标签。
/** 排除私用区、资源标识和无可见文字的字符串。 */
const is_noise = (text: string): boolean =>
  NOISE.test(text) || !/\p{L}/u.test(text.replace(MARKUP, ""));
const TEXT_APPEARANCE = /\s|[^\p{ASCII}]/u;
const DISPLAY_PROPERTIES = new Set([
  "text",
  "tooltip_text",
  "dialog_text",
  "placeholder_text",
  "title",
]);
const CODE_PROPERTIES = new Set(["code", "source_code", "expression"]); // 着色器或表达式源码。
const DISPLAY_PROPERTY_PATH = /(?:^|\/)(?:text|tooltip_text|dialog_text|placeholder_text)$/u; // 含 popup/item_0/text 等列表项。
const TITLE_NODES = new Set([
  "Window",
  "AcceptDialog",
  "ConfirmationDialog",
  "FileDialog",
  "Popup",
]);
const DISPLAY_CALLS = new Set([
  "tr",
  "tr_n",
  "atr",
  "atr_n",
  "set_text",
  "set_tooltip_text",
  "set_placeholder",
  "add_item",
  "add_icon_item",
  "add_check_item",
  "add_radio_check_item",
  "set_item_text",
  "set_item_tooltip",
  "set_tab_title",
  "add_text",
  "append_text",
]);
const CODE_CALLS = new Set([
  "print",
  "printerr",
  "prints",
  "printt",
  "print_debug",
  "print_rich",
  "push_error",
  "push_warning",
  "get_node",
  "get_node_or_null",
  "has_node",
  "find_child",
  "find_children",
  "load",
  "connect",
  "disconnect",
  "is_connected",
  "emit_signal",
  "has_signal",
  "call",
  "call_deferred",
  "callv",
  "has_method",
  "get",
  "set",
  "has",
  "erase",
  "get_meta",
  "set_meta",
  "has_meta",
  "begins_with",
  "ends_with",
  "contains",
  "find",
  "rfind",
  "replace",
  "split",
  "Color",
  "is_action_pressed",
  "is_action_just_pressed",
  "is_action_just_released",
  "get_action_strength",
  "is_in_group",
  "add_to_group",
  "remove_from_group",
  "get_nodes_in_group",
  "get_first_node_in_group",
  "get_setting",
  "has_setting",
  "set_setting",
  "play",
  "has_animation",
  "travel",
  "change_scene_to_file",
  "file_exists",
  "dir_exists",
]);
const DATA_RESOURCE = "Resource"; // 自定义脚本资源的顶层类型；引擎内置资源（字体、着色器、主题等）不承载显示文本。
const NON_TEXT_CLASSES = new Set(["GDScript", "Shader", "ShaderInclude", "VisualShader"]); // 内嵌代码整体不是显示文本。
const CALL_SCAN_LIMIT = 512; // 只向前查找当前表达式所在调用，超长参数列表按无调用处理。
type Verdict = boolean | null; // null 表示噪声，false 保留为可人工放行的条目。
type Gdc = ReturnType<typeof read_gdsc>;
/** 向前配平括号，返回字面量直接所在的调用；位于数组或字典内时没有调用者。 */
function enclosing_call(g: Gdc, index: number): { name: string; keyword: boolean } | undefined {
  let depth = 0;
  for (let i = index - 1; i >= 0 && index - i <= CALL_SCAN_LIMIT; i--) {
    const kind = g.tokens[i]!.kind;
    if (kind === "PARENTHESIS_CLOSE" || kind === "BRACKET_CLOSE" || kind === "BRACE_CLOSE") depth++;
    else if (kind === "PARENTHESIS_OPEN" || kind === "BRACKET_OPEN" || kind === "BRACE_OPEN") {
      if (depth--) continue;
      if (kind !== "PARENTHESIS_OPEN") return undefined;
      const callee = g.tokens[i - 1];
      if (callee?.kind === "IDENTIFIER" || callee?.kind === "ANNOTATION")
        return {
          name: g.identifiers[callee.reference]!,
          keyword: callee.kind === "ANNOTATION",
        };
      return callee?.kind === "ASSERT" ? { name: "assert", keyword: true } : undefined;
    }
  }
  return undefined;
}
/** token 上下文先保护程序用途，显示用途与外观规则决定其余候选。 */
function classify_script_literal(g: Gdc, index: number, is_key: (s: string) => boolean): Verdict {
  const text = String(g.constants[g.tokens[index]!.reference]!.value);
  if (is_noise(text)) return null;
  if (is_key(text)) return false;
  const at = (offset: number) => g.tokens[index + offset]?.kind; // 读取当前字面量邻近的 token 类型。
  /** 读取当前字面量邻近的标识符名称。 */
  const name = (offset: number) => {
    const t = g.tokens[index + offset];
    return t?.kind === "IDENTIFIER" ? g.identifiers[t.reference] : undefined;
  };
  if (at(-1) === "EQUAL" && DISPLAY_PROPERTIES.has(name(-2) ?? "")) return true;
  if (at(-1) === "EQUAL" && CODE_PROPERTIES.has(name(-2) ?? "")) return false;
  const call = enclosing_call(g, index);
  if (call && !call.keyword && DISPLAY_CALLS.has(call.name)) return true;
  if (at(1) === "COLON") return false;
  const compare: (TokenKind | undefined)[] = ["EQUAL_EQUAL", "BANG_EQUAL", "IN"];
  if (compare.includes(at(1)) || [...compare, "MATCH"].includes(at(-1))) return false;
  const indexed: (TokenKind | undefined)[] = ["IDENTIFIER", "BRACKET_CLOSE", "PARENTHESIS_CLOSE"];
  if (at(-1) === "BRACKET_OPEN" && indexed.includes(at(-2))) return false;
  if (call?.keyword) return false;
  if (call && CODE_CALLS.has(call.name)) return false;
  return classify_appearance(text);
}
/** 无语法上下文时只看字符串外观。 */
function classify_appearance(text: string): Verdict {
  return is_noise(text) ? null : TEXT_APPEARANCE.test(text);
}
/** StringName 是引擎标识符类型，非噪声值一律规则跳过。 */
function classify_string_name(text: string): Verdict {
  return is_noise(text) ? null : false;
}
/** 源码脚本没有 token，只用字面量两侧字符识别字典键和比较。 */
function classify_source_literal(
  source: string,
  start: number,
  end: number,
  text: string,
  is_key: (text: string) => boolean,
): Verdict {
  if (is_noise(text)) return null;
  if (is_key(text)) return false;
  const before = source.slice(Math.max(0, start - 4), start),
    after = source.slice(end, end + 4);
  if (/^\s*:(?!=)/u.test(after)) return false;
  if (/(?:==|!=)\s*$/u.test(before) || /^\s*(?:==|!=|in\b)/u.test(after)) return false;
  return classify_appearance(text);
}
/** 语言表消息键集合：优化表只能按哈希判断，其余语言表直接读取键。 */
function read_keys(file: string, bytes: Buffer): (s: string) => boolean {
  if (godot_member_kind(file, bytes) === "po") {
    const ids = new Set(
      read_po(bytes.toString("utf8"))
        .filter((f) => f.kind === "msgid" || f.kind === "msgid_plural")
        .map((f) => f.text),
    );
    return (s) => ids.has(s);
  }
  const doc = read_resource(bytes);
  if (doc.type === "OptimizedTranslation") {
    const slot = translation_slot(read_translation(doc));
    return (s) => slot(s) !== undefined;
  }
  const ids = new Set(read_messages(doc).map((message) => message.key));
  return (s) => ids.has(s);
}
/**
 * 一个游戏共用一次提取上下文：语言表选择和消息键集合来自全部成员，单个成员只解释自身字节。
 * 产品实现对应 GameFormatAdapter.create_members(files) 返回的成员处理器。
 */
export function create_text_extractor(files: ReadonlyMap<string, Buffer>) {
  const plan = plan_translation_locale(files),
    keys = [...plan.tables].map((file) => read_keys(file, files.get(file)!)),
    is_key = (s: string) => keys.some((has) => has(s)); // 选定语言表共同决定消息键身份。
  return {
    plan,
    extract: (file: string, bytes: Buffer) => extract(file, bytes, plan.tables, is_key), // 成员共用本次语言表计划与消息键集合。
  };
}
/** 成员按格式解释原稿坐标，语言表只提取选定 locale 的译文槽位。 */
function extract(
  file: string,
  bytes: Buffer,
  tables: ReadonlySet<string>,
  is_key: (s: string) => boolean,
): TextEntry[] {
  const entries: TextEntry[] = [];
  /** 噪声不产生条目，其余结果保留可翻译或规则跳过状态。 */
  const add = (location: GodotLocation, original: string, verdict: Verdict) => {
    if (verdict === null) return;
    entries.push({
      location,
      original,
      eligible: verdict,
    });
  };
  // 场景与资源字符串若是语言表消息键，控件会经 tr() 显示语言表译文，字符串本身不再翻译。
  const classify_value = (v: Value): Verdict =>
    v.type === 44
      ? classify_string_name(String(v.value))
      : is_key(String(v.value)) && !is_noise(String(v.value))
        ? false
        : classify_appearance(String(v.value));
  switch (godot_member_kind(file, bytes)) {
    case "gdsc": {
      const g = read_gdsc(bytes);
      for (const t of g.tokens) {
        const v = g.constants[t.reference];
        if (t.kind !== "LITERAL" || v?.type !== 4 || typeof v.value !== "string") continue;
        add({ kind: "gdsc", token: t.index }, v.value, classify_script_literal(g, t.index, is_key));
      }
      break;
    }
    case "resource": {
      const resource = read_resource(bytes);
      if (resource.type === "PackedScene")
        for (const p of read_scene(resource).properties) {
          if ((p.value.type !== 5 && p.value.type !== 44) || typeof p.value.value !== "string")
            continue;
          const display =
            p.value.type === 5 &&
            !is_noise(p.value.value) &&
            !is_key(p.value.value) &&
            (DISPLAY_PROPERTY_PATH.test(p.property) ||
              (p.property === "title" && TITLE_NODES.has(p.nodeType)));
          add(
            { kind: "scene", node: p.node, property: p.property },
            p.value.value,
            display ? true : classify_value(p.value),
          );
        }
      else if (resource.type === DATA_RESOURCE)
        for (const property of resource.properties) {
          if (NON_TEXT_CLASSES.has(property.className)) continue;
          for (const v of all_values(property.value))
            if (typeof v.value === "string" && (v.type === 5 || v.type === 44))
              add({ kind: "resource", offset: v.start }, v.value, classify_value(v));
        }
      break;
    }
    case "translation": {
      if (!tables.has(file)) break;
      const resource = read_resource(bytes);
      if (resource.type === "OptimizedTranslation")
        for (const s of read_translation(resource).slots)
          add({ kind: "slot", word: s.index }, s.text, true);
      else
        for (const message of read_messages(resource))
          for (const v of message.texts)
            if (v.value) add({ kind: "resource", offset: v.start }, v.value as string, true);
      break;
    }
    case "gd": {
      const source = bytes.toString("utf8");
      for (const v of read_source(source))
        if (!v.qualifier)
          add(
            { kind: "gd", start: v.start, end: v.end },
            v.text,
            classify_source_literal(source, v.start, v.end, v.text, is_key),
          );
      break;
    }
    case "po":
      if (tables.has(file))
        for (const field of read_po(bytes.toString("utf8")))
          if (
            field.kind === "msgstr" &&
            field.text &&
            !/^(?:Project-Id-Version|Language|Content-Type):/mu.test(field.text)
          )
            add({ kind: "po", start: field.start, end: field.end }, field.text, true);
  }
  return entries;
}
