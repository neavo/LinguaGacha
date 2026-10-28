import { create_checkpoint } from "./checkpoint";
import assert from "node:assert/strict";
import { GAME_METADATA_MEMBER, type GameFiles } from "../shared/game/format";
import {
  readable_json,
  write_projection,
  type ProjectionFailure,
  type ReadableFile,
} from "../shared/game/readable";
import { extract_script, type RenpyCandidate } from "./extract";
import { read_member } from "./member";
import { attributes, class_name, resolve_node, type PickleNode } from "./pickle";
import { read_renpy_format_metadata } from "./profile";
import { PythonSession } from "./python-syntax";
import {
  block_lines,
  code_edge,
  code_location,
  definition_target,
  menu_item_lines,
  node_children as children,
  node_text,
  node_value as value,
  statement_line,
} from "./script";

/** 字段在部分版本中为 `None`，视图按空文本省略。 */
const text = (edge: PickleNode | undefined): string => {
  const scalar = edge && resolve_node(edge).value;
  return typeof scalar === "string" || Buffer.isBuffer(scalar) ? node_text(edge) : "";
};

/**
 * 每个编译脚本写出近似脚本 `x.rpyc.reference.rpy` 与字符串映射 `x.rpyc.reference.json`。
 * `strings[].key` 与条目的 `renpy.key` 相同，`write_mode` 说明原文和译文是文字还是 Python 源码。
 * `line` 是字符串在近似脚本中的实际行，`source_line` 是原始 `.rpy` 的行。
 * 同一原始行有多条语句时，近似脚本顺延后面的语句，两者因此不同。
 */
export async function* read_renpy_projections(
  files: GameFiles,
  report?: ProjectionFailure,
  signal?: AbortSignal,
): AsyncGenerator<ReadableFile> {
  const member = files.get(GAME_METADATA_MEMBER);
  assert(member, "Missing Ren'Py format metadata; import the game again");
  const metadata = read_renpy_format_metadata(await member.async("uint8array"));
  using session = await PythonSession.create();
  for (const [file, entry] of files) {
    signal?.throwIfAborted();
    if (file === GAME_METADATA_MEMBER) continue;
    yield* write_projection(
      file,
      async () => {
        const member = await read_member(
          await entry.async("uint8array"),
          metadata.python_major === 2,
          signal,
        );
        const script = await extract_script(member, session, signal);
        for (const warning of script.warnings) report?.(file, new Error(warning.message));
        const slot = member.slots[0]!;
        const writer = new ScriptWriter(signal);
        for (const statement of children(children(slot.graph.root)[1]))
          await render(writer, statement, 0);
        return [
          [file + ".reference.rpy", writer.lines.join("\n") + "\n"],
          [
            file + ".reference.json",
            readable_json({
              internal_file_path: file,
              strings: script.candidates.map((candidate) => ({
                key: candidate.key,
                text: candidate.text,
                usage: candidate.usage,
                write_mode: candidate.write_mode,
                line: writer.line_of(candidate, slot.slot),
                source_line: candidate.line,
              })),
            }),
          ],
        ];
      },
      report,
      signal,
    );
    session.clear();
  }
}

/** 带消费边的源码片段，写出时记录它在视图中的位置。 */
type Code = { edge: PickleNode; text: string; line: number | null };
type Part = string | Code | null; // 一行中的片段，`null` 表示省略。

/** 输出行游标：已知行号在游标之后时补空行对齐，否则顺延到下一行，顺序永不改变。 */
class ScriptWriter {
  public readonly checkpoint: () => Promise<void> | undefined;
  /** 整份投影共用批次预算，嵌套语句沿用同一取消信号。 */
  public constructor(public readonly signal?: AbortSignal) {
    this.checkpoint = create_checkpoint(signal);
  }

  public readonly lines: string[] = []; // 近似脚本的输出行。
  public strings: string | null = null; // 连续的 `TranslateString` 共用一个 `translate … strings:` 头。
  private readonly anchors = new Map<number, { line: number; edge: PickleNode }>(); // 消费边偏移 → 其源码首行在视图中的行。

  /** 片段拼成一行写出，跨行源码的续行保留原有缩进并连续放置，返回首行在视图中的行号。 */
  public write(line: number | null, depth: number, ...parts: Part[]): number {
    let row = "";
    const anchors: [Code, number][] = [];
    for (const part of parts) {
      if (part === null) continue;
      if (typeof part === "string") row += part;
      else {
        anchors.push([part, row.split("\n").length - 1]);
        row += part.text;
      }
    }
    const rows = row.split("\n");
    rows.forEach((part, index) => {
      const at = line === null ? null : line + index;
      while (at !== null && this.lines.length < at - 1) this.lines.push("");
      this.lines.push(index === 0 ? "    ".repeat(depth) + part : part);
    });
    const first = this.lines.length - rows.length + 1;
    for (const [code, offset] of anchors) this.anchor(code.edge, first + offset);
    return first;
  }

  /** 单行写作 `$ code`。Python 块存入前已去掉整块缩进，逐行补回一层。 */
  public python(line: number | null, depth: number, header: string, code: Code | null): void {
    if (!code) return void this.write(line, depth, header + ": # compiled Python AST");
    if (!code.text.includes("\n")) return void this.write(line, depth, "$ ", code);
    this.write(line, depth, header + ":");
    const rows = code.text.split("\n");
    const skip = rows[0]!.trim() ? 0 : 1; // 块源码首行对应 `python:` 所在行，内容为空。
    const body = rows
      .slice(skip)
      .map((row) => (row.trim() ? "    ".repeat(depth + 1) + row : ""))
      .join("\n");
    const first = this.write(code.line === null ? null : code.line + skip, 0, body);
    this.anchor(code.edge, first - skip);
  }

  /** 候选所在视图行：取槽位 1 中已写出的消费边，代码字面量再加上其在源码内的行偏移。 */
  public line_of(candidate: RenpyCandidate, slot: number): number | null {
    for (const coordinate of candidate.coordinates) {
      const anchor = coordinate.slot === slot ? this.anchors.get(coordinate.edge) : undefined;
      if (!anchor) continue;
      if (coordinate.start === undefined) return anchor.line;
      return anchor.line + text(anchor.edge).slice(0, coordinate.start).split("\n").length - 1;
    }
    return null;
  }

  /** 共享节点可能被多处渲染，按首次写出的位置定位。 */
  private anchor(edge: PickleNode, line: number): void {
    if (!this.anchors.has(edge.start)) this.anchors.set(edge.start, { line, edge });
  }
}

/** 字符串与 `PyExpr`、`PyCode` 统一取源码消费边、文本和源码行号。 */
function code_of(edge: PickleNode | undefined): Code | null {
  const source = edge && code_edge(edge);
  if (!source) return null;
  return { edge: source, text: text(source).replaceAll("\r", ""), line: code_location(edge)[1] };
}
/** 整个字段写作带引号的字符串，消费边就是字段本身。 */
const quoted = (edge: PickleNode | undefined): Part =>
  edge ? { edge, text: JSON.stringify(text(edge)), line: null } : '""';

/** 字段名以真实节点为准，缺失字段直接省略。未知类写出类名，并继续下钻语句块。 */
async function render(writer: ScriptWriter, edge: PickleNode, depth: number): Promise<void> {
  const pause = writer.checkpoint();
  if (pause) await pause;
  const node = resolve_node(edge),
    full_name = class_name(node),
    cls = full_name.replace(/^renpy\.(?:ast|sl2\.slast)\./u, ""),
    fields = attributes(node),
    line = statement_line(node);
  const field = (name: string) => fields.get(name);
  const block = (name: string, child_depth = depth + 1) =>
    render_block(writer, field(name), child_depth);
  if (cls !== "TranslateString") writer.strings = null;
  switch (cls) {
    case "Init":
    case "EndTranslate":
      return block("block", depth);
    case "Translate":
      // 基础语言的翻译包装由引擎为每句对白自动生成，源码中不存在。
      if (value(field("language")) === null) return block("block", depth);
      writer.write(
        line,
        depth,
        `translate ${text(field("language"))} ${text(field("identifier"))}:`,
      );
      return block("block");
    case "TranslateString": {
      const language = value(field("language")) === null ? "None" : text(field("language"));
      if (writer.strings !== language)
        writer.write(line === null ? null : line - 1, depth, `translate ${language} strings:`);
      writer.strings = language;
      const new_line = value(children(field("newloc"))[1]);
      writer.write(line, depth + 1, "old ", quoted(field("old")));
      writer.write(
        typeof new_line === "number" ? new_line : null,
        depth + 1,
        "new ",
        quoted(field("new")),
      );
      return;
    }
    case "Label":
      writer.write(line, depth, `label ${text(field("name"))}:`);
      return block("block");
    case "Say": {
      const who = code_of(field("who"));
      writer.write(
        line,
        depth,
        who,
        who && " ",
        quoted(field("what")),
        ...argument_parts(field("arguments")),
      );
      return;
    }
    case "Menu": {
      writer.write(line, depth, "menu", ...argument_parts(field("arguments")), ":");
      const lines = await menu_item_lines(node, writer.signal);
      const item_arguments = children(field("item_arguments"));
      for (const [index, item] of children(field("items")).entries()) {
        const [label, condition, body] = children(item);
        const head = [quoted(label), ...argument_parts(item_arguments[index])];
        if (!body || resolve_node(body).kind !== "list") {
          writer.write(lines[index]!, depth + 1, ...head);
          continue;
        }
        const guard = code_of(condition);
        if (!guard || guard.text === "True") writer.write(lines[index]!, depth + 1, ...head, ":");
        else writer.write(lines[index]!, depth + 1, ...head, " if ", guard, ":");
        await render_block(writer, body, depth + 2);
      }
      return;
    }
    case "If":
    case "SLIf":
    case "SLShowIf":
      for (const [index, entry] of children(field("entries")).entries()) {
        const [condition, body] = children(entry);
        const guard =
          condition && resolve_node(condition).kind !== "none" ? code_of(condition) : null;
        const lines = body ? await block_lines(body, writer.signal) : null;
        const at = index === 0 ? line : lines && lines[0] - 1;
        if (index === 0)
          writer.write(at, depth, cls === "SLShowIf" ? "showif " : "if ", guard, ":");
        else if (guard === null || guard.text === "True") writer.write(at, depth, "else:");
        else writer.write(at, depth, "elif ", guard, ":");
        await render_block(writer, body, depth + 1);
      }
      return;
    case "While":
      writer.write(line, depth, "while ", code_of(field("condition")), ":");
      return block("block");
    case "Jump":
    case "Call":
      writer.write(
        line,
        depth,
        cls === "Jump" ? "jump " : "call ",
        value(field("expression")) ? "expression " : "",
        code_of(field(cls === "Jump" ? "target" : "label")),
        ...argument_parts(field("arguments")),
      );
      return;
    case "Return": {
      const result = code_of(field("expression"));
      writer.write(line, depth, "return", result && " ", result);
      return;
    }
    case "Pass":
      writer.write(line, depth, "pass");
      return;
    case "Python":
    case "EarlyPython":
    case "SLPython":
      return writer.python(
        line,
        depth,
        cls === "EarlyPython" ? "python early" : "python",
        code_of(field("code")),
      );
    case "Define":
    case "Default": {
      const code = code_of(field("code")),
        index = code_of(field("index"));
      writer.write(
        line,
        depth,
        `${cls.toLowerCase()} ${definition_target(fields)}`,
        index && "[",
        index,
        index && "]",
        code && ` ${text(field("operator")) || "="} `,
        code,
      );
      return;
    }
    case "Style": {
      const parent = text(field("parent"));
      writer.write(
        line,
        depth,
        `style ${text(field("style_name"))}${parent ? " is " + parent : ""}:`,
      );
      const properties = children(field("properties"));
      for (let index = 0; index + 1 < properties.length; index += 2)
        writer.write(
          null,
          depth + 1,
          `${text(properties[index])} `,
          code_of(properties[index + 1]),
        );
      return;
    }
    case "Image": {
      const name = children(field("imgname")).map(text).join(" ");
      const code = code_of(field("code"));
      if (code) return void writer.write(line, depth, `image ${name} = `, code);
      writer.write(line, depth, `image ${name}:`);
      return void writer.write(null, depth + 1, "# ATL");
    }
    case "Show":
    case "Scene":
    case "Hide": {
      const imspec = children(field("imspec"));
      const expression =
        imspec[1] && resolve_node(imspec[1]).kind !== "none" ? code_of(imspec[1]) : null;
      const at = children(imspec[3]).flatMap((entry, index) => [
        index === 0 ? " at " : ", ",
        code_of(entry),
      ]);
      const atl = field("atl") && resolve_node(field("atl")!).kind !== "none";
      writer.write(
        line,
        depth,
        cls.toLowerCase(),
        expression ? " expression " : " ",
        expression ?? children(imspec[0]).map(text).join(" "),
        ...at,
        atl ? ":" : "",
      );
      if (atl) writer.write(null, depth + 1, "# ATL");
      return;
    }
    case "With": {
      const expression = code_of(field("expr"));
      if (expression && expression.text !== "None") writer.write(line, depth, "with ", expression); // `None` 是引擎为 `show … with` 生成的配对语句。
      return;
    }
    case "UserStatement":
      writer.write(line, depth, text(field("line")));
      return;
    case "Screen": {
      const screen = field("screen");
      if (screen && class_name(screen) === "renpy.screenlang.ScreenLangScreen") {
        writer.write(line, depth, `screen ${text(attributes(screen).get("name"))}:`);
        return void writer.write(null, depth + 1, "# legacy screen language");
      }
      return block("screen", depth);
    }
    case "SLScreen":
      writer.write(line, depth, `screen ${text(field("name"))}:`);
      return screen_body(writer, fields, depth + 1);
    case "SLDisplayable": {
      const name =
        text(field("name")) ||
        text(field("displayable"))
          .split(/[.\n]/u)
          .filter(Boolean)
          .at(-1)!
          .replace(/^_/u, "")
          .toLowerCase();
      const positional = children(field("positional")).flatMap((entry) => [" ", code_of(entry)]);
      const nested = children(field("children")).length > 0;
      writer.write(
        line,
        depth,
        name,
        ...positional,
        ...keywords(fields).flatMap((parts) => [" ", ...parts]),
        nested ? ":" : "",
      );
      return block("children");
    }
    case "SLBlock":
      return screen_body(writer, fields, depth);
    case "SLFor":
      writer.write(
        line,
        depth,
        `for ${text(field("variable"))} in `,
        code_of(field("expression")),
        ":",
      );
      return screen_body(writer, fields, depth + 1);
    case "SLUse":
      writer.write(line, depth, "use ", code_of(field("target")), ...argument_parts(field("args")));
      return block("block");
    case "SLDefault":
      writer.write(
        line,
        depth,
        `default ${text(field("variable"))} = `,
        code_of(field("expression")),
      );
      return;
    default:
      writer.write(line, depth, "# " + full_name);
      await block("block");
      return block("children");
  }
}

/** 语句块可以是语句列表，也可以是单个节点（如 `SLBlock`）。 */
async function render_block(
  writer: ScriptWriter,
  edge: PickleNode | undefined,
  depth: number,
): Promise<void> {
  const node = edge && resolve_node(edge);
  if (node?.kind === "list") for (const child of node.children) await render(writer, child, depth);
  else if (node?.kind === "object") await render(writer, node, depth);
}

/** `ArgumentInfo` 写作调用参数列表，缺失时为空。 */
function argument_parts(edge: PickleNode | undefined): Part[] {
  if (!edge || resolve_node(edge).kind !== "object") return [];
  const fields = attributes(edge);
  const indexes = (name: string) =>
    new Set(children(fields.get(name)).map((entry) => Number(value(entry))));
  const starred = indexes("starred_indexes"),
    doublestarred = indexes("doublestarred_indexes");
  return [
    "(",
    ...children(fields.get("arguments")).flatMap((pair, index) => {
      const [name, expression] = children(pair);
      const prefix = starred.has(index)
        ? "*"
        : doublestarred.has(index)
          ? "**"
          : text(name) && text(name) + "=";
      return [index ? ", " : "", prefix, code_of(expression)];
    }),
    ")",
  ];
}

/** SL2 关键字属性写作 `key value`。 */
function keywords(fields: ReadonlyMap<string, PickleNode>): Part[][] {
  return children(fields.get("keyword")).map((pair) => {
    const [key, expression] = children(pair);
    return [`${text(key)} `, code_of(expression)];
  });
}

/** SL2 块的关键字属性逐行写出，子节点同一缩进。 */
async function screen_body(
  writer: ScriptWriter,
  fields: ReadonlyMap<string, PickleNode>,
  depth: number,
): Promise<void> {
  for (const parts of keywords(fields)) writer.write(null, depth, ...parts);
  for (const child of children(fields.get("children"))) await render(writer, child, depth);
}
