import { readFileSync } from "node:fs";
import { parseSync, Visitor } from "oxc-parser";

/** 每次检查独占源码快照，所有规则共享按需读取的文本、AST 和导入列表。 */
export function create_source_reader(read = (file_path) => readFileSync(file_path, "utf8")) {
  const sources = new Map();

  /** 首次访问固定文本快照，后续解析与导入提取共用同一记录。 */
  function read_source(file_path) {
    let source = sources.get(file_path);
    if (source === undefined) {
      source = { content: read(file_path), ast: undefined, imports: undefined };
      sources.set(file_path, source);
    }
    return source;
  }

  /** 纯文本规则读取内容时无需构造 AST。 */
  function read_file(file_path) {
    return read_source(file_path).content;
  }

  /** 按扩展名解析源码，四组规则复用一次解析结果。 */
  function read_ast(file_path) {
    const source = read_source(file_path);
    if (source.ast === undefined) {
      const result = parseSync(file_path, source.content, {
        // 括号只改变表达式组合，规则直接检查内部表达式。
        preserveParens: false,
      });
      // Oxc 可在解析失败后返回部分 AST；失败必须终止检查，避免漏报违规。
      if (result.errors.length > 0) {
        throw new SyntaxError(
          `Cannot parse ${file_path}:\n${result.errors.map((error) => error.codeframe ?? error.message).join("\n")}`,
          { cause: result.errors },
        );
      }
      source.ast = result.program;
    }
    return source.ast;
  }

  /** 导入边界与 CLI 依赖追踪共享源码顺序下的依赖及位置。 */
  function read_imports(file_path) {
    const source = read_source(file_path);
    if (source.imports === undefined) {
      const imports = [];
      // 只把字符串目标视为可静态追踪的依赖，类型导入同样参与边界检查。
      const collect = (node) => {
        if (node.source?.type === "Literal" && typeof node.source.value === "string") {
          imports.push({
            line: line_number_at(source.content, node.start),
            specifier: node.source.value,
          });
        }
      };
      new Visitor({
        ImportDeclaration: collect,
        ExportNamedDeclaration: collect,
        ExportAllDeclaration: collect,
        ImportExpression: collect,
      }).visit(read_ast(file_path));
      source.imports = imports;
    }
    return source.imports;
  }

  return { read_file, read_ast, read_imports };
}

/** 源码位置使用 UTF-16 偏移；诊断行号同时识别 ECMAScript 的全部行终止符。 */
export function line_number_at(content, index) {
  return content.slice(0, index).split(/\r\n|[\n\r\u2028\u2029]/u).length;
}
