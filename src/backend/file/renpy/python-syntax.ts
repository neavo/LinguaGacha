import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate } from "node:timers/promises";
import type { Node, Parser, Tree } from "web-tree-sitter";
import { decode_python, PythonDecodeError, type PythonLiteral } from "./python";

export type PythonMode = "eval" | "exec" | "hide";
export type PythonInput = Readonly<{ source: string; mode: PythonMode }>;
export type PythonArgument =
  | { kind: "positional"; index: number }
  | { kind: "keyword"; name: string };
export type PythonDiagnostic = Readonly<{ start: number; end: number; reason: string }>;
/** 仅表示源码分析失败，业务层补充来源并决定终止或保留原稿。 */
export class PythonSyntaxError extends Error {
  constructor(public readonly diagnostic: PythonDiagnostic) {
    super(`${diagnostic.reason} at ${diagnostic.start}`);
  }
}
export type PythonConstant = {
  start: number;
  end: number;
  value: string;
  call: string;
  argument: PythonArgument | undefined;
  whole: boolean;
  dynamic: boolean;
  percent: boolean; // 字符串是 `%` 格式化的左操作数。
};
export type PythonAssignment = {
  target: string;
  root: boolean;
  operation: string;
  value: PythonValue;
  start: number;
  end: number;
};
export type PythonValue = string | number | boolean | null | PythonValue[] | undefined;
export type PythonFacts = {
  constants: PythonConstant[];
  assignments: PythonAssignment[];
  references: string[];
  bare_references: string[];
  diagnostics: PythonDiagnostic[];
  expression: { value: PythonValue; start: number; end: number } | undefined;
};
const PARSE_SLICE_MS = 8;
const WALK_SLICE_NODES = 512;
let runtime_directory: string | undefined;
let language:
  | Promise<{
      module: typeof import("web-tree-sitter");
      language: import("web-tree-sitter").Language;
    }>
  | undefined;
/** 宿主和准备线程显式注入同一运行目录，资源路径不进入工程。 */
export function configure_python_parser(directory: string): void {
  runtime_directory = directory;
  language = undefined;
}
/** 按宿主注入的工作区加载解析资源，失败包含实际资源路径。 */
async function load_language() {
  language ??= (async () => {
    assert(runtime_directory, "Python parser workspace runtime directory is required");
    const require = createRequire(path.join(runtime_directory, "package.json"));
    const wasm = path.join(runtime_directory, "python/tree-sitter-python.wasm");
    try {
      const module: typeof import("web-tree-sitter") = await import(
        /* @vite-ignore */ pathToFileURL(require.resolve("web-tree-sitter")).href
      );
      await module.Parser.init({
        locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
      });
      return { module, language: await module.Language.load(wasm) };
    } catch (cause) {
      throw new Error("Cannot load Python parser resources: " + wasm, { cause });
    }
  })();
  return language;
}
export const python_children = (node: Node): Node[] =>
  node.namedChildren.filter((child) => child.type !== "comment");
/** 只解析静态属性链，调用和下标表达式没有可确定的名称。 */
export function python_name(node: Node | null): string {
  if (!node) return "";
  if (node.type === "identifier") return node.text;
  if (node.type === "attribute")
    return (
      python_name(node.childForFieldName("object")) +
      "." +
      python_name(node.childForFieldName("attribute"))
    );
  return "";
}
/** CST 提供字面量边界，字符串解码由 `python.ts` 负责。 */
function token(node: Node): PythonLiteral {
  const start = node.namedChildren.find((child) => child.type === "string_start");
  const end = node.namedChildren.find((child) => child.type === "string_end");
  assert(start && end, "Incomplete Python string");
  if (!/['"]/u.test(start.text)) throw new PythonDecodeError("Unsupported Python repr expression");
  const prefix = /^[a-z]*/iu.exec(start.text)![0];
  return {
    prefix,
    body: node.text.slice(start.text.length, -end.text.length),
  };
}
/** 只读取已支持的字面量结构，未知表达式不求值。 */
export function python_value(node: Node | null, python2 = false, bytes = false): PythonValue {
  if (!node) return undefined;
  const children = python_children(node);
  if (["parenthesized_expression", "expression_statement"].includes(node.type))
    return python_value(children[0] ?? null, python2, bytes);
  if (node.type === "string") {
    const literal = token(node);
    if (bytes && /^b$/iu.test(literal.prefix)) literal.prefix = "";
    return decode_python(literal, python2);
  }
  if (node.type === "concatenated_string") {
    const values = children.map((child) => python_value(child, python2, bytes));
    return values.every((value) => typeof value === "string") ? values.join("") : undefined;
  }
  if (["list", "tuple"].includes(node.type))
    return children.map((child) => python_value(child, python2, bytes));
  if (node.type === "integer" && /^\d+$/u.test(node.text)) return Number(node.text);
  if (node.type === "true") return true;
  if (node.type === "false") return false;
  if (node.type === "none") return null;
  return undefined;
}
export type PythonView = { root: Node; nodes: readonly Node[]; offset: number };
/** 一次操作独占可变 Parser，树和游标只活到消费回调结束。 */
export class PythonSession {
  private constructor(private readonly parser: Parser) {}
  /** 每次操作独占 `Parser`，语言资源在线程内复用。 */
  public static async create(): Promise<PythonSession> {
    const loaded = await load_language();
    const parser = new loaded.module.Parser();
    parser.setLanguage(loaded.language);
    return new PythonSession(parser);
  }
  /** 操作结束时释放 `Parser` 持有的 WASM 资源。 */
  public [Symbol.dispose](): void {
    this.parser.delete();
  }
  /** 回调只在树存活期间消费 CST，所有退出路径都释放树并重置解析器。 */
  public async read<T>(
    input: PythonInput,
    consume: (view: PythonView) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    // Ren'Py py_compile 接受缩进代码体；包装不属于用户控制流。
    const prefix =
      input.mode === "eval"
        ? "(\n"
        : /^[ \t]+\S/mu.test(
              input.source
                .split(/\r?\n/u)
                .find((line) => line.trim() && !line.trimStart().startsWith("#")) ?? "",
            )
          ? "if True:\n"
          : "";
    const source = prefix + input.source + (input.mode === "eval" ? "\n)" : "");
    let tree: Tree | null = null;
    try {
      do {
        await setImmediate();
        signal?.throwIfAborted();
        const deadline = performance.now() + PARSE_SLICE_MS;
        tree = this.parser.parse(source, null, {
          progressCallback: () => performance.now() >= deadline,
        });
      } while (!tree);
      const nodes: Node[] = [];
      const cursor = tree.walk();
      try {
        let more = true;
        while (more) {
          const node = cursor.currentNode;
          if (
            node.isError ||
            node.isMissing ||
            (node.type === "block" && python_children(node).length === 0)
          )
            throw new PythonSyntaxError({
              start: Math.max(0, Math.min(input.source.length, node.startIndex - prefix.length)),
              end: Math.max(0, Math.min(input.source.length, node.endIndex - prefix.length)),
              reason: "Invalid Python syntax",
            });
          nodes.push(node);
          if (nodes.length % WALK_SLICE_NODES === 0) {
            await setImmediate();
            signal?.throwIfAborted();
          }
          if (cursor.gotoFirstChild()) continue;
          while (!cursor.gotoNextSibling()) {
            if (!cursor.gotoParent()) {
              more = false;
              break;
            }
          }
        }
      } finally {
        cursor.delete();
      }
      const root =
        prefix === "if True:\n"
          ? tree.rootNode.namedChildren[0]!.childForFieldName("consequence")!
          : tree.rootNode;
      return consume({ root, nodes, offset: prefix.length });
    } finally {
      tree?.delete();
      this.parser.reset();
    }
  }
  /** 返回独立语法事实，范围扣除临时包装，常量采用调用方指定的解码条件。 */
  public async analyze(
    input: PythonInput,
    python2 = false,
    signal?: AbortSignal,
  ): Promise<PythonFacts> {
    return this.read(
      input,
      ({ root, nodes, offset }) => {
        const facts: PythonFacts = {
          constants: [],
          assignments: [],
          references: [],
          bare_references: [],
          diagnostics: [],
          expression: undefined,
        };
        if (input.mode === "eval") {
          const wrapper = root.namedChildren[0]?.namedChildren[0];
          const expression = wrapper ? python_children(wrapper)[0] : undefined;
          if (expression) {
            let value: PythonValue;
            try {
              value = python_value(expression, python2);
            } catch (error) {
              if (!(error instanceof PythonDecodeError)) throw error;
            }
            facts.expression = {
              value,
              start: expression.startIndex - offset,
              end: expression.endIndex - offset,
            };
          }
        }
        for (const node of nodes) {
          if (["identifier", "attribute"].includes(node.type)) {
            const name = python_name(node);
            facts.references.push(name);
            if (node.parent?.type !== "attribute") facts.bare_references.push(name);
          }
          if (["assignment", "augmented_assignment"].includes(node.type)) {
            const right = node.childForFieldName("right");
            let value: PythonValue;
            try {
              value = python_value(right, python2);
            } catch (error) {
              if (!(error instanceof PythonDecodeError)) throw error;
              value = undefined;
            }
            facts.assignments.push({
              target: python_name(node.childForFieldName("left")),
              root:
                node.parent?.type === "expression_statement" && node.parent.parent?.id === root.id,
              operation:
                node.type === "assignment" ? "=" : (node.childForFieldName("operator")?.text ?? ""),
              value,
              start: (right?.startIndex ?? node.startIndex) - offset,
              end: (right?.endIndex ?? node.endIndex) - offset,
            });
          }
          if (
            !["string", "concatenated_string"].includes(node.type) ||
            node.parent?.type === "concatenated_string"
          )
            continue;
          let value: PythonValue;
          try {
            value = python_value(node, python2);
          } catch (error) {
            if (!(error instanceof PythonDecodeError)) throw error;
            facts.diagnostics.push({
              start: node.startIndex - offset,
              end: node.endIndex - offset,
              reason: error.message,
            });
            continue;
          }
          if (typeof value !== "string") continue;
          let expression = node,
            percent = false;
          while (
            expression.parent?.type === "parenthesized_expression" ||
            (expression.parent?.type === "binary_operator" &&
              expression.parent.childForFieldName("operator")?.text === "%" &&
              expression.parent.childForFieldName("left")?.id === expression.id)
          ) {
            percent ||= expression.parent.type === "binary_operator";
            expression = expression.parent;
          }
          const parent = expression.parent;
          const keyword =
            parent?.type === "keyword_argument"
              ? (parent.childForFieldName("name")?.text ?? "")
              : "";
          const argument = keyword ? parent! : expression;
          const args = argument.parent;
          const call =
            args?.type === "argument_list"
              ? python_name(args.parent?.childForFieldName("function") ?? null)
              : "";
          let dynamic = false;
          for (
            let ancestor = node.parent;
            ancestor && ancestor.id !== root.id;
            ancestor = ancestor.parent
          )
            if (
              ["interpolation", "string"].includes(ancestor.type) ||
              (ancestor.type === "binary_operator" &&
                ancestor.childForFieldName("operator")?.text !== "%")
            )
              dynamic = true;
          facts.constants.push({
            start: node.startIndex - offset,
            end: node.endIndex - offset,
            value,
            call,
            argument:
              args?.type !== "argument_list"
                ? undefined
                : keyword
                  ? { kind: "keyword", name: keyword }
                  : (() => {
                      const preceding = python_children(args).slice(
                        0,
                        python_children(args).findIndex((entry) => entry.id === argument.id),
                      );
                      if (preceding.some((entry) => entry.type === "list_splat")) return undefined;
                      return {
                        kind: "positional" as const,
                        index: preceding.filter(
                          (entry) => !["keyword_argument", "dictionary_splat"].includes(entry.type),
                        ).length,
                      };
                    })(),
            whole:
              expression.parent?.type === "expression_statement" &&
              expression.parent.parent?.id === root.id,
            dynamic,
            percent,
          });
        }
        return facts;
      },
      signal,
    );
  }
}
