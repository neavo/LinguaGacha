import type { Node } from "web-tree-sitter";
import {
  python_children,
  python_name,
  type PythonConstant,
  type PythonFacts,
  type PythonInput,
  type PythonSession,
} from "./python-syntax";

type SpeakerLiteral = Pick<PythonConstant, "start" | "end" | "value">;
const CHARACTER_CALLS = new Set([
  "Character",
  "renpy.character.Character",
  "DynamicCharacter",
  "renpy.character.DynamicCharacter",
]);

/** 源码与早期 Ren’Py 引擎保存的 Python AST 共用调用资格，undefined 表示非标准角色调用。 */
export function static_character_name(
  callable: string,
  dynamic: boolean | "unknown" | undefined,
  unknown_kind: boolean,
  expanded: boolean,
): boolean | undefined {
  if (!CHARACTER_CALLS.has(callable)) return undefined;
  return (
    !callable.endsWith("DynamicCharacter") &&
    !expanded &&
    (dynamic === undefined ? !unknown_kind : dynamic === false)
  );
}
/** 仅解释当前表达式；返回的范围始终指向可独立写回的 Python 字面量。 */
export async function read_speaker_expression(
  input: PythonInput,
  facts: PythonFacts,
  session: PythonSession,
): Promise<{ name: SpeakerLiteral | undefined; usages: Map<number, "display" | "code"> }> {
  return session.read(input, ({ nodes, offset }) => {
    const usages = new Map<number, "display" | "code">(); // 姓名参数的语义覆盖通用字符串用途。
    /** 括号不改变姓名语义，源码范围仍由字面量提供。 */
    const unwrap = (node: Node): Node =>
      node.type === "parenthesized_expression" ? unwrap(python_children(node)[0]!) : node;
    /** 标记调用只剥离 _()，其他函数结果仍由游戏运行时决定。 */
    const literal = (node: Node | null): PythonConstant | undefined => {
      if (!node) return undefined;
      node = unwrap(node);
      if (node.type === "call" && python_name(node.childForFieldName("function")) === "_") {
        const args = python_children(node.childForFieldName("arguments")!);
        if (args.length !== 1) return undefined;
        node = unwrap(args[0]!);
      }
      return facts.constants.find(
        (token) =>
          token.writable &&
          !token.dynamic &&
          token.start === node.startIndex - offset &&
          token.end === node.endIndex - offset,
      );
    };
    /** 读取当前调用的姓名参数和资格，未知继承或展开参数交给静态资格规则处理。 */
    const character = (node: Node): { name: Node | null; static_name: boolean } | undefined => {
      if (node.type !== "call") return undefined;
      const callable = python_name(node.childForFieldName("function"));
      if (!CHARACTER_CALLS.has(callable)) return undefined;
      const args = python_children(node.childForFieldName("arguments")!);
      const positional = args.filter((arg) => arg.type !== "keyword_argument");
      /** 位置参数与关键字参数共用引擎规定的参数绑定。 */
      const argument = (name: string, index?: number): Node | null =>
        args
          .find(
            (arg) =>
              arg.type === "keyword_argument" && arg.childForFieldName("name")?.text === name,
          )
          ?.childForFieldName("value") ??
        (index === undefined ? null : (positional[index] ?? null));
      const dynamic = argument("dynamic"),
        kind = argument("kind", 1);
      return {
        name: argument("name", 0),
        static_name: static_character_name(
          callable,
          !dynamic ? undefined : unwrap(dynamic).type === "false" ? false : "unknown",
          !!kind && unwrap(kind).type !== "none",
          args.some((arg) => ["list_splat", "dictionary_splat"].includes(arg.type)),
        )!,
      };
    };
    for (const node of nodes) {
      const call = character(node);
      if (!call?.name) continue;
      // 动态姓名内的标记函数也不能把运行时表达式提升为显示文本。
      const name = literal(call.name);
      for (const token of facts.constants) {
        if (
          token.start >= call.name.startIndex - offset &&
          token.end <= call.name.endIndex - offset
        )
          usages.set(token.start, call.static_name && token === name ? "display" : "code");
      }
    }
    const expression = facts.expression;
    const node =
      expression &&
      nodes.find(
        (node) =>
          node.startIndex - offset === expression.start &&
          node.endIndex - offset === expression.end,
      );
    if (!node) return { name: undefined, usages };
    const root = unwrap(node),
      call = character(root);
    const name = call ? (call.static_name ? literal(call.name) : undefined) : literal(root);
    return { name, usages };
  });
}
