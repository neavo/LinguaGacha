import assert from "node:assert/strict";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { create_item, type Item } from "../../../domain/item";
import type { SourceFileParseWarning } from "../file-format-types";
import { encode_javascript_string, read_javascript_strings } from "../shared/javascript";
import { splice } from "../shared/splice";
import { read_config_title, write_config_title } from "./config";
import {
  read_tyrano_metadata,
  tyrano_default_status,
  type TyranoLocation,
  type TyranoUsage,
} from "./item";
import {
  decode_static_text,
  encode_static_text,
  runtime_value,
  scan_scene,
  scene_structure,
  scene_values,
  type SceneLine,
  type SceneNode,
  type SceneSyntax,
} from "./scene";

/** 已知用途的参数总是产生条目，其余参数只在含非 ASCII 字符时进入审校，避免文件名、数值和标识符淹没列表。 */
const KNOWN_PARAMS: ReadonlyMap<string, TyranoUsage> = new Map([
  ["text.val", "text"], // 本产品为无法直接书写的正文生成的标签。
  ["glink.text", "text"],
  ["ptext.text", "text"],
  ["mtext.text", "text"],
  ["tb_ptext_show.text", "text"],
  ["dialog.text", "text"],
  ["title.name", "text"],
  ["ruby.text", "text"],
  ["chara_new.jname", "name"],
  ["chara_ptext.name", "name"],
  ["voconfig.name", "parameter"], // 语音设置的查找键，修改姓名时须一起核对。
]);
const EXPRESSION_KEYS = new Set(["exp", "cond", "preexp"]); // 参数值是 JavaScript 表达式。
const NON_ASCII = /\P{ASCII}/u; // 未知参数的减噪条件。
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]); // 引擎读取时忽略，输出原样保留。

/** 本次解析的可写位置，持久定位与临时节点索引指向同一份原稿。 */
type Target = {
  location: TyranoLocation;
  usage: TyranoUsage;
  value: string; // 运行时字面值，静态字符表达式已解码。
  line: number;
  source_context?: string;
  node?: number; // 场景节点序号，脚本与配置目标没有节点。
  key?: string; // 参数目标的参数名。
};
type Scene = { nodes: SceneNode[]; lines: SceneLine[] }; // 场景成员的扫描结果，供写回逐行试解析。
type Edit = { start: number; end: number; value: string }; // 原稿 UTF-16 范围上的替换。

/** 成员语法由所在路径决定：Config.tjs、普通 JavaScript 或场景脚本。 */
function member_kind(file: string): "config" | "script" | "scene" {
  if (path.posix.basename(file).toLowerCase() === "config.tjs") return "config";
  return path.posix.extname(file).toLowerCase() === ".js" ? "script" : "scene";
}

/** 引擎按 UTF-8 读取脚本，BOM 不参与坐标并在输出时保留。 */
function decode_member(content: Uint8Array): { bom: boolean; text: string } {
  const bom = Buffer.from(content.subarray(0, 3)).equals(UTF8_BOM);
  return {
    bom,
    text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bom ? content.subarray(3) : content,
    ),
  };
}

/** 提取与写回共用同一组目标，确保条目定位就是写回时验证的范围。 */
function read_targets(
  text: string,
  file: string,
  syntax: SceneSyntax,
): { targets: Target[]; scene: Scene | null; warnings: SourceFileParseWarning[] } {
  const targets: Target[] = [];
  const warnings: SourceFileParseWarning[] = [];
  const kind = member_kind(file);
  /** 字符串偏移按 `locate` 换算到原稿，语法错误使该段脚本不产生条目。 */
  const script = (
    source: string,
    locate: (offset: number) => { offset: number; line: number },
    line: number,
  ) => {
    const result = read_javascript_strings(source);
    if (!result.ok) {
      warnings.push({
        code: "script_syntax_error",
        rel_path: file,
        location: "line " + (line + 1),
        diagnostics: result.diagnostics,
      });
      return;
    }
    for (const span of result.strings) {
      const start = locate(span.start);
      targets.push({
        location: {
          kind: "script",
          start: start.offset,
          end: locate(span.end).offset,
          template: span.template,
        },
        usage: "code",
        value: span.src,
        line: start.line,
        source_context: span.source_context,
      });
    }
  };
  if (kind === "config") {
    const title = read_config_title(text);
    if (title?.value)
      targets.push({
        location: { kind: "config", start: title.start, end: title.end },
        usage: "text",
        value: title.value,
        line: text.slice(0, title.start).split("\n").length - 1,
      });
    return { targets, scene: null, warnings };
  }
  if (kind === "script") {
    const starts = [0, ...[...text.matchAll(/\n/gu)].map((match) => match.index + 1)];
    script(
      text,
      (offset) => ({ offset, line: starts.findLastIndex((start) => start <= offset) }),
      0,
    );
    return { targets, scene: null, warnings };
  }
  const scene = scan_scene(text, syntax);
  const blocks = new Map<
    number,
    { source: string; line: number; segments: { js: number; node: SceneNode & { kind: "text" } }[] }
  >();
  scene.nodes.forEach((node, index) => {
    if (node.kind === "text") {
      if (node.mode === "script") {
        // 引擎把块内每个文本节点追加换行后拼成脚本，偏移按片段换算回原稿。
        const block = blocks.get(node.block) ?? { source: "", line: node.line, segments: [] };
        block.segments.push({ js: block.source.length, node });
        block.source += node.value + "\n";
        blocks.set(node.block, block);
        return;
      }
      const value = runtime_value(node.value, syntax.parser === "legacy");
      const literal = node.mode === "text" && value.startsWith("=");
      targets.push({
        location: { kind: "text", start: node.start, end: node.end },
        usage: literal ? "text" : "code",
        value: literal ? value.slice(1) : node.value,
        line: node.line,
        node: index,
      });
    } else if (node.kind === "tag") {
      for (const param of node.params) {
        const candidate = classify_param(node.name, param.key, node.pm.get(param.key)!);
        if (!candidate) continue;
        targets.push({
          ...candidate,
          location: { kind: "param", start: param.start, end: param.end },
          line: node.line,
          source_context: text.slice(node.start, node.end),
          node: index,
          key: param.key,
        });
      }
    } else if (node.kind === "name" && node.name !== "") {
      const literal =
        decode_static_text(node.name) ?? (/^[&%]/u.test(node.name) ? null : node.name);
      targets.push({
        location: { kind: "name", start: node.start, end: node.end },
        usage: literal === null ? "code" : "name",
        value: literal ?? node.name,
        line: node.line,
        node: index,
      });
    }
  });
  for (const block of blocks.values())
    script(
      block.source,
      (offset) => {
        // 片段末尾的位置属于该片段，模板片段可以从换行处开始。
        const segment = block.segments.find(
          (entry) => offset >= entry.js && offset <= entry.js + entry.node.value.length,
        );
        assert(segment, "Unmapped Tyrano script offset");
        return { offset: segment.node.start + offset - segment.js, line: segment.node.line };
      },
      block.line,
    );
  return { targets, scene, warnings };
}

/** 参数用途的唯一判定入口。`%` 宏参数引用不产生条目，表达式按代码处理，其余按已知用途或 ASCII 减噪规则。 */
function classify_param(
  tag: string,
  key: string,
  raw: string,
): { usage: TyranoUsage; value: string } | null {
  if (raw === "" || raw.startsWith("%")) return null;
  const literal = decode_static_text(raw) ?? (raw.startsWith("&") ? null : raw);
  if (literal === null || EXPRESSION_KEYS.has(key))
    return NON_ASCII.test(raw) ? { usage: "code", value: raw } : null;
  const usage = KNOWN_PARAMS.get(tag + "." + key);
  if (usage) return { usage, value: literal };
  return NON_ASCII.test(literal) ? { usage: "parameter", value: literal } : null;
}

/** 每个可写位置生成一个条目，零条目成员仍由容器清单保留。 */
export function read_tyrano_member(
  content: Uint8Array,
  file: string,
  syntax: SceneSyntax,
): { items: Item[]; warnings: SourceFileParseWarning[] } {
  const { targets, warnings } = read_targets(decode_member(content).text, file, syntax);
  const items = targets.map((target, row) => {
    const extra_field = {
      tyrano: {
        internal_file_path: file,
        usage: target.usage,
        location: target.location,
        line: target.line + 1,
        ...(target.source_context === undefined ? {} : { source_context: target.source_context }),
      },
    };
    return create_item({
      src: target.value,
      file_type: "TYRANO",
      file_path: file,
      row,
      status: tyrano_default_status({ extra_field }),
      extra_field,
    });
  });
  return { items, warnings };
}

/** 从固化原稿计算写回。场景脚本逐行优先使用普通写法，无法无损表示时改用静态字符表达式，最后整份复核。 */
export function render_tyrano_member(
  content: Uint8Array,
  file: string,
  syntax: SceneSyntax,
  items: readonly Item[],
): Uint8Array {
  const completed = items.filter((item) => item.status === "PROCESSED" && item.dst !== item.src);
  if (completed.length === 0) return content;
  const { bom, text } = decode_member(content);
  const { targets, scene } = read_targets(text, file, syntax);
  const index = new Map(targets.map((target) => [location_key(target.location), target]));
  const changes = new Map<Target, string>();
  for (const item of completed) {
    const metadata = read_tyrano_metadata(item.extra_field);
    assert.equal(metadata.internal_file_path, file, "Mismatched Tyrano member");
    const target = index.get(location_key(metadata.location));
    assert(
      target && target.value === item.src,
      "Stale Tyrano location: " + file + ":" + metadata.line,
    );
    assert(!changes.has(target), "Duplicate Tyrano location: " + file + ":" + metadata.line);
    changes.set(target, item.dst);
  }
  const output = scene
    ? write_scene(text, scene, changes, syntax, file)
    : member_kind(file) === "config"
      ? write_config_title(text, [...changes.values()][0]!) // 配置只有标题一个目标。
      : splice_text(
          text,
          [...changes].map(([target, value]) => ({
            ...target.location,
            value: encode_javascript_string(value, target.location.template === true),
          })),
        );
  return Buffer.concat([bom ? UTF8_BOM : Buffer.alloc(0), Buffer.from(output)]);
}

/** 普通写法失败时改用编码。脚本字符串转义场景终止标记，输出前核对整份场景。 */
function write_scene(
  text: string,
  scene: Scene,
  changes: ReadonlyMap<Target, string>,
  syntax: SceneSyntax,
  file: string,
): string {
  const expected = [...scene.nodes];
  const edits: Edit[] = [];
  const lines = new Map<number, { changes: [Target, string][]; nodes: SceneNode[] }>();
  for (const [target, value] of changes) {
    if (target.location.kind === "script") {
      // 引擎在任意含 `endscript` 的行结束脚本模式，十六进制转义保持字符串值不变。
      const literal = encode_javascript_string(value, target.location.template === true).replaceAll(
        "endscript",
        "\\x65ndscript",
      );
      edits.push({ start: target.location.start, end: target.location.end, value: literal });
      continue;
    }
    const node = expected[target.node!]!;
    // 代码位置按原值写入。其余位置用编码表示字面值，新版正文不展开实体。
    const entity = target.location.kind !== "text" || syntax.parser === "legacy";
    const runtime = target.usage === "code" || !entity ? value : encode_static_text(value);
    expected[target.node!] =
      node.kind === "text"
        ? { ...node, value: runtime }
        : node.kind === "tag"
          ? { ...node, pm: new Map(node.pm).set(target.key!, runtime) }
          : node.kind === "name"
            ? { ...node, name: runtime }
            : node;
    const group = lines.get(target.line) ?? { changes: [], nodes: [] };
    group.changes.push([target, value]);
    lines.set(target.line, group);
  }
  // 一次分组保留同一行的未修改节点，避免每个修改行都遍历整份场景。
  for (const node of expected) lines.get(node.line)?.nodes.push(node);
  for (const [index, group] of lines) {
    const line = scene.lines[index]!;
    /** 在原行状态下验证候选写法，编码回退也必须保留该行的其他节点。 */
    const attempt = (encode: boolean): Edit[] | null => {
      const candidate: Edit[] = [];
      for (const [target, value] of group.changes) {
        const plain =
          encode && target.usage !== "code"
            ? null
            : plain_value(target, value, scene.nodes[target.node!]!, line, syntax);
        const written = plain ?? (target.usage === "code" ? null : encoded_value(target, value));
        if (written === null) return null;
        candidate.push({ ...target.location, value: written });
      }
      const source = splice_text(
        text.slice(line.start, line.end),
        candidate.map((edit) => ({
          ...edit,
          start: edit.start - line.start,
          end: edit.end - line.start,
        })),
      );
      return scene_mismatch(scan_scene(source, syntax, line.state).nodes, group.nodes, syntax) ===
        null
        ? candidate
        : null;
    };
    const accepted = attempt(false) ?? attempt(true);
    assert(accepted, "Tyrano translation cannot be represented: " + file + ":" + (index + 1));
    edits.push(...accepted);
  }
  const output = splice_text(text, edits);
  const mismatch = scene_mismatch(scan_scene(output, syntax).nodes, expected, syntax);
  assert(mismatch === null, "Tyrano output changed scene " + mismatch + ": " + file);
  return output;
}

/** 先核对结构再核对取值。多行脚本字符串合并为一行等结构变化会改变标签序号，直接拒绝。 */
function scene_mismatch(
  actual: readonly SceneNode[],
  expected: readonly SceneNode[],
  syntax: SceneSyntax,
): "structure" | "values" | null {
  if (!isDeepStrictEqual(scene_structure(actual), scene_structure(expected))) return "structure";
  return isDeepStrictEqual(scene_values(actual, syntax), scene_values(expected, syntax))
    ? null
    : "values";
}

/** 普通写法只做必要转义，能否无损表示由逐行试解析判定。 */
function plain_value(
  target: Target,
  value: string,
  node: SceneNode,
  line: SceneLine,
  syntax: SceneSyntax,
): string | null {
  const kind = target.location.kind;
  if (kind === "name") return value;
  if (kind === "text") {
    const escaped = syntax.parser === "modern" ? value.replace(/[\\[]/gu, "\\$&") : value;
    // 行首 `_` 让引擎保留前导空白，并阻止正文被识别为注释、姓名、标签或标签行。
    return node.kind === "text" &&
      node.start === line.content &&
      !line.escaped &&
      /^[\s;#*@_/]/u.test(escaped)
      ? "_" + escaped
      : escaped;
  }
  // 新版引擎在反斜杠后直到结束引号前都保持转义，含反斜杠的值没有普通写法。
  if (syntax.parser === "modern" && value.includes("\\")) return null;
  const quote = (syntax.parser === "modern" ? ['"', "'", "`"] : ['"', "'"]).find(
    (quote) =>
      !value.includes(quote) &&
      (quote === "`" || syntax.keep_space !== "1" || !value.includes(" ")),
  );
  return quote === undefined ? null : quote + value + quote;
}

/** 静态字符表达式不含空格、引号和方括号，正文改用等价的 `[text]` 标签。 */
function encoded_value(target: Target, value: string): string {
  const encoded = encode_static_text(value);
  if (target.location.kind === "text") return '[text val="' + encoded + '"]';
  return target.location.kind === "param" ? '"' + encoded + '"' : encoded;
}

/** 原稿范围与语法位置共同标识目标，防止不同编码规则共用同一范围。 */
function location_key(location: TyranoLocation): string {
  return location.kind + ":" + location.start + ":" + location.end;
}

/** 文本坐标是 UTF-16 下标，按 UTF-16LE 字节复用共享的重叠检查。 */
function splice_text(text: string, edits: readonly Edit[]): string {
  return splice(
    Buffer.from(text, "utf16le"),
    edits.map((edit) => ({
      start: edit.start * 2,
      end: edit.end * 2,
      bytes: Buffer.from(edit.value, "utf16le"),
    })),
  ).toString("utf16le");
}
