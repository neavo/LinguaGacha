import { parse } from "@babel/parser";

import { is_test_file } from "./core.mjs";

const HAN_PATTERN = /\p{Script=Han}/u;
const ERROR_IDENTIFIER_PATTERN = /^(?:error|cause|caught|[A-Za-z_$][\w$]*_error)$/u;
const ERROR_MESSAGE_METHODS = new Set(["startsWith", "endsWith", "includes"]);
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);

/** 错误契约规则覆盖所有生产 JavaScript / TypeScript，不把测试夹具当作产品文本。 */
export function create_error_contract_rules() {
  const ast_by_path = new Map();
  const read_ast = (context, file_path) => {
    let ast = ast_by_path.get(file_path);
    if (ast === undefined) {
      ast = parse(context.read_file(file_path), {
        allowReturnOutsideFunction: true,
        attachComment: false,
        plugins: ["typescript", "jsx"],
        sourceFilename: file_path,
        sourceType: "unambiguous",
      });
      ast_by_path.set(file_path, ast);
    }
    return ast;
  };

  return [
    create_source_rule(
      "异常文本语言",
      "非 i18n 异常文本必须使用英文",
      find_han_error_text_positions,
      read_ast,
    ),
    create_source_rule(
      "错误控制流",
      "错误分支必须按类型或 code 判断，不得解析 Error.message",
      find_error_message_control_flow_positions,
      read_ast,
    ),
  ];
}

function create_source_rule(name, message, find_positions, read_ast) {
  return {
    name,
    check: (context) => {
      return context.files.filter(is_production_source).flatMap((file_path) => {
        const content = context.read_file(file_path);
        return find_positions(read_ast(context, file_path)).map((position) => ({
          relative_path: context.relative_path(file_path),
          line: line_number_at(content, position),
          message,
        }));
      });
    },
  };
}

function is_production_source(file_path) {
  return /\.[cm]?[jt]sx?$/u.test(file_path) && !is_test_file(file_path);
}

/** 只检查 throw 表达式和 Error 调用参数中的源码字面量。 */
function find_han_error_text_positions(ast) {
  const positions = new Set();

  walk(ast, (node) => {
    if (node.type === "ThrowStatement") {
      collect_han_text_positions(node.argument, positions);
    }
    if (
      (node.type === "NewExpression" || node.type === "CallExpression") &&
      is_error_callee(node.callee)
    ) {
      for (const argument of node.arguments) collect_han_text_positions(argument, positions);
    }
  });

  return [...positions].sort((left, right) => left - right);
}

function collect_han_text_positions(node, positions) {
  walk(node, (child) => {
    const text =
      child.type === "StringLiteral"
        ? child.value
        : child.type === "TemplateElement"
          ? child.value.raw
          : null;
    const offset = text?.search(HAN_PATTERN) ?? -1;
    if (offset !== -1) positions.add((child.start ?? 0) + offset);
  });
}

function is_error_callee(node) {
  const name =
    node.type === "Identifier"
      ? node.name
      : is_member_expression(node) && !node.computed && node.property.type === "Identifier"
        ? node.property.name
        : "";
  return name.endsWith("Error");
}

/** 仅识别参与比较、字符串判别或 switch 的 error.message，普通日志 message 字段不误报。 */
function find_error_message_control_flow_positions(ast) {
  const positions = new Set();

  walk(ast, (node) => {
    if (
      node.type === "BinaryExpression" &&
      EQUALITY_OPERATORS.has(node.operator) &&
      (is_error_message_member(node.left) || is_error_message_member(node.right))
    ) {
      positions.add(node.start ?? 0);
    } else if (node.type === "SwitchStatement" && is_error_message_member(node.discriminant)) {
      positions.add(node.start ?? 0);
    } else if (
      (node.type === "CallExpression" || node.type === "OptionalCallExpression") &&
      is_member_expression(node.callee) &&
      !node.callee.computed &&
      node.callee.property.type === "Identifier" &&
      ERROR_MESSAGE_METHODS.has(node.callee.property.name) &&
      is_error_message_member(node.callee.object)
    ) {
      positions.add(node.start ?? 0);
    }
  });

  return [...positions].sort((left, right) => left - right);
}

function is_error_message_member(node) {
  return (
    is_member_expression(node) &&
    !node.computed &&
    node.object.type === "Identifier" &&
    ERROR_IDENTIFIER_PATTERN.test(node.object.name) &&
    node.property.type === "Identifier" &&
    node.property.name === "message"
  );
}

function is_member_expression(node) {
  return node.type === "MemberExpression" || node.type === "OptionalMemberExpression";
}

function walk(node, visit) {
  if (node === null || typeof node !== "object" || typeof node.type !== "string") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["comments", "errors", "extra", "loc", "tokens"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else {
      walk(value, visit);
    }
  }
}

function line_number_at(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length;
}
