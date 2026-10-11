import type { Node } from "oxc-parser";
import type { RPGMakerUsage } from "./types";

/** 只凭静态结构排除接口标识，无法证明用途的字符串保留翻译资格。 */
export function read_javascript_usage(node: Node, ancestors: readonly Node[]): RPGMakerUsage {
  let parent_index = ancestors.length - 1;
  let target = node;
  const template = ancestors[parent_index];
  // 静态模板整体承担参数或属性角色，含插值的片段保留为候选。
  if (node.type === "TemplateElement" && template?.type === "TemplateLiteral") {
    if (template.expressions.length > 0) return "text";
    target = template;
    parent_index--;
  }
  const parent = ancestors[parent_index];
  if (!parent) return "text";
  if (
    ((parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition") &&
      parent.key === target) ||
    (parent.type === "MemberExpression" && parent.property === target)
  )
    return "metadata";

  if (
    parent.type === "Property" &&
    parent.value === target &&
    ["name", "description"].includes(static_name(parent.key, parent.computed))
  ) {
    const record = ancestors[parent_index - 1]; // 祖先链限定为插件数组的直接记录。
    const array = ancestors[parent_index - 2];
    const owner = ancestors[parent_index - 3];
    if (
      record?.type === "ObjectExpression" &&
      array?.type === "ArrayExpression" &&
      ((owner?.type === "VariableDeclarator" &&
        owner.init === array &&
        owner.id.type === "Identifier" &&
        owner.id.name === "$plugins") ||
        (owner?.type === "AssignmentExpression" &&
          owner.operator === "=" &&
          owner.right === array &&
          owner.left.type === "Identifier" &&
          owner.left.name === "$plugins"))
    )
      return "metadata";
  }

  if (parent.type === "CallExpression" && parent.callee.type === "MemberExpression") {
    const callee = parent.callee;
    const manager = callee.object.type === "Identifier" ? callee.object.name : "";
    const method = static_name(callee.property, callee.computed);
    const slot = parent.arguments.findIndex((argument) => argument === target);
    // 展开参数长度未知，后续实参无法按静态位置确定用途。
    if (parent.arguments.slice(0, slot).some((argument) => argument.type === "SpreadElement"))
      return "text";
    if (
      (manager === "PluginManager" && method === "parameters" && slot === 0) ||
      (manager === "PluginManager" && method === "registerCommand" && (slot === 0 || slot === 1)) ||
      (manager === "PluginManagerEx" && method === "registerCommand" && slot === 1)
    )
      return "metadata";
  }
  return "text";
}

/** 读取语法中已确定的名称，动态计算返回空值。 */
function static_name(node: Node, computed: boolean): string {
  if (node.type === "Identifier" && !computed) return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? "";
  return "";
}
