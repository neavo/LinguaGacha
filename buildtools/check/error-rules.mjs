import { parse } from "@babel/parser";

import { is_test_file, line_number_at, walk_ast } from "./core.mjs";

const HAN_PATTERN = /\p{Script=Han}/u;
const ERROR_IDENTIFIER_PATTERN = /^(?:error|cause|caught|[A-Za-z_$][\w$]*_error)$/u;
const ERROR_MESSAGE_METHODS = new Set(["startsWith", "endsWith", "includes"]);
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);

/** 错误契约规则覆盖所有生产 JavaScript / TypeScript，不把测试夹具当作产品文本。 */
export function create_error_contract_rules() {
  const ast_by_path = new Map(); // 两条错误规则复用同一次检查中的解析结果
  /** 按文件缓存当前检查的 AST，规则只负责各自的位置判断。 */
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

/** 把 AST 位置转换为统一规则诊断，两个错误检查复用文件范围和行号口径。 */
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

/** 错误规则覆盖 JS / TS，测试夹具按仓库统一后缀排除。 */
function is_production_source(file_path) {
  return /\.[cm]?[jt]sx?$/u.test(file_path) && !is_test_file(file_path);
}

/** 只检查 throw 表达式和 Error 调用参数中的源码字面量。 */
function find_han_error_text_positions(ast) {
  const positions = new Set();

  walk_ast(ast, (node) => {
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

/** 遍历错误表达式中的字符串和模板片段，定位实际包含中文的部分。 */
function collect_han_text_positions(node, positions) {
  walk_ast(node, (child) => {
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

/** 直接构造和命名空间构造的 Error 子类沿同一命名约定识别。 */
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

  walk_ast(ast, (node) => {
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

/** 仅识别错误变量的 message，避免把业务对象同名字段当作错误控制流。 */
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

/** 普通属性访问与可选链共享后续字段识别。 */
function is_member_expression(node) {
  return node.type === "MemberExpression" || node.type === "OptionalMemberExpression";
}
