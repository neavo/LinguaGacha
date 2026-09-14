import { Visitor } from "oxc-parser";

import { is_test_file } from "./core.mjs";
import { line_number_at } from "./source-reader.mjs";

const HAN_PATTERN = /\p{Script=Han}/u;
const ERROR_IDENTIFIER_PATTERN = /^(?:error|cause|caught|[A-Za-z_$][\w$]*_error)$/u;
const ERROR_MESSAGE_METHODS = new Set(["startsWith", "endsWith", "includes"]);
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);

/** 错误契约规则覆盖所有生产 JavaScript / TypeScript，不把测试夹具当作产品文本。 */
export function create_error_contract_rules() {
  return [
    create_source_rule(
      "异常文本语言",
      "非 i18n 异常文本必须使用英文",
      find_han_error_text_positions,
    ),
    create_source_rule(
      "错误控制流",
      "错误分支必须按类型或 code 判断，不得解析 Error.message",
      find_error_message_control_flow_positions,
    ),
  ];
}

/** 把 AST 位置转换为统一规则诊断，两个错误检查复用文件范围和行号口径。 */
function create_source_rule(name, message, find_positions) {
  return {
    name,
    check: (context) => {
      return context.files.filter(is_production_source).flatMap((file_path) => {
        const content = context.read_file(file_path);
        return find_positions(context.read_ast(file_path), content).map((position) => ({
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
function find_han_error_text_positions(ast, content) {
  const positions = new Set();
  const error_expressions = [];
  const collect_arguments = (node) => {
    if (is_error_callee(node.callee)) error_expressions.push(...node.arguments);
  };
  const collect_text = (node, text) => {
    if (!HAN_PATTERN.test(text)) return;
    if (
      !error_expressions.some(
        (expression) => node.start >= expression.start && node.end <= expression.end,
      )
    )
      return;
    // 使用原始源码定位跨行字面量；Unicode 转义产生的中文定位到字面量起点。
    const offset = content.slice(node.start, node.end).search(HAN_PATTERN);
    positions.add(node.start + Math.max(offset, 0));
  };

  // Visitor 先进入父节点再访问子节点；范围只收录 throw 表达式与 Error 参数，排除构造器接收者。
  new Visitor({
    ThrowStatement(node) {
      error_expressions.push(node.argument);
    },
    NewExpression: collect_arguments,
    CallExpression: collect_arguments,
    Literal(node) {
      if (typeof node.value === "string") collect_text(node, node.value);
    },
    TemplateElement(node) {
      collect_text(node, node.value.raw);
    },
  }).visit(ast);

  return [...positions].sort((left, right) => left - right);
}

/** 直接构造和命名空间构造的 Error 子类沿同一命名约定识别。 */
function is_error_callee(node) {
  node = unwrap_chain(node);
  const name =
    node.type === "Identifier"
      ? node.name
      : node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
        ? node.property.name
        : "";
  return name.endsWith("Error");
}

/** 仅识别参与比较、字符串判别或 switch 的 error.message，普通日志 message 字段不误报。 */
function find_error_message_control_flow_positions(ast) {
  const positions = new Set();

  new Visitor({
    BinaryExpression(node) {
      if (
        EQUALITY_OPERATORS.has(node.operator) &&
        (is_error_message_member(node.left) || is_error_message_member(node.right))
      ) {
        positions.add(node.start);
      }
    },
    SwitchStatement(node) {
      if (is_error_message_member(node.discriminant)) positions.add(node.start);
    },
    CallExpression(node) {
      const callee = unwrap_chain(node.callee);
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier" &&
        ERROR_MESSAGE_METHODS.has(callee.property.name) &&
        is_error_message_member(callee.object)
      ) {
        positions.add(node.start);
      }
    },
  }).visit(ast);

  return [...positions].sort((left, right) => left - right);
}

/** 仅识别错误变量的 message，避免把业务对象同名字段当作错误控制流。 */
function is_error_message_member(node) {
  node = unwrap_chain(node);
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    ERROR_IDENTIFIER_PATTERN.test(node.object.name) &&
    node.property.type === "Identifier" &&
    node.property.name === "message"
  );
}

/** ESTree 用 ChainExpression 包裹可选链，属性判断消费其内部表达式。 */
function unwrap_chain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}
