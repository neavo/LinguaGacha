import type { Node } from "web-tree-sitter";

/** 语法事实与姓名事实共用的 CST 读取，注释节点不参与结构判断。 */
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
