/** 常量语义不确定时允许局部跳过，调用方仍须传播资源与程序错误。 */
export class PythonDecodeError extends Error {}
/** 用可局部跳过的解码错误报告不支持的字面量。 */
function require_literal(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new PythonDecodeError(reason);
}

export type PythonLiteral = {
  prefix: string;
  body: string;
};
/** _p 的字符串表键按段落折叠空白，提取与重映射必须使用同一规则。 */
export function paragraph_text(text: string): string {
  const lines = text.split("\n").map((line) => line.trim());
  if (lines[0] === "") lines.shift();
  if (lines.at(-1) === "") lines.pop();
  let result = "";
  const paragraph: string[] = [];
  for (const line of lines) {
    if (!line) {
      result += paragraph.join(" ") + "\n\n";
      paragraph.length = 0;
    } else {
      paragraph.push(line);
      if (/\{p[^}]*\}$/u.test(line)) {
        result += paragraph.join(" ");
        paragraph.length = 0;
      }
    }
  }
  return result + paragraph.join(" ");
}
/** 只解释普通字符串转义，f-string 由语法分析按源码范围记录。 */
export function decode_python(token: PythonLiteral, python2 = false): string {
  require_literal(
    !/[bf]/iu.test(token.prefix),
    "Bytes and formatted literals require expression analysis",
  );
  require_literal(!/^(?:ur|ru)$/iu.test(token.prefix), "Unsupported Python ur literal");
  if (/r/iu.test(token.prefix)) return token.body.replace(/\r\n?/gu, "\n");
  return token.body
    .replace(/\r\n?/gu, "\n")
    .replace(
      /\\(?:\r\n|\n|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|[^\r\n])/gu,
      (escape) => {
        const body = escape.slice(1);
        require_literal(
          !(
            python2 &&
            !/u/iu.test(token.prefix) &&
            (/^[uU]/u.test(body) ||
              (body.startsWith("x") && Number.parseInt(body.slice(1), 16) >= 128) ||
              (/^[0-7]/u.test(body) && Number.parseInt(body, 8) >= 128))
          ),
          "Ambiguous Python 2 string semantics",
        );
        if (body === "\n" || body === "\r\n") return "";
        const known: Record<string, string> = {
          "\\": "\\",
          "'": "'",
          '"': '"',
          a: "\x07",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
          v: "\v",
        };
        if (Object.hasOwn(known, body)) return known[body]!;
        if (/^[xuU]/u.test(body)) {
          const code = Number.parseInt(body.slice(1), 16);
          require_literal(
            Number.isFinite(code) && code <= 0x10ffff,
            "Unsupported Python escape: " + escape,
          );
          return String.fromCodePoint(code);
        }
        if (/^[0-7]/u.test(body)) return String.fromCodePoint(Number.parseInt(body, 8));
        require_literal(!/^[xuUN]/u.test(body), "Unsupported Python escape: " + escape);
        return escape;
      },
    );
}
/** ASCII 转义同时适用于 Python 2 与 Python 3，避免源码编码影响译文。控制字符（含 NUL）写作转义。 */
export function encode_python(text: string): string {
  return (
    'u"' +
    [...text]
      .map((char) => {
        const code = char.codePointAt(0)!;
        if (char === '"' || char === "\\") return "\\" + char;
        if (code < 32 || code >= 127)
          return code <= 0xffff
            ? "\\u" + code.toString(16).padStart(4, "0")
            : "\\U" + code.toString(16).padStart(8, "0");
        return char;
      })
      .join("") +
    '"'
  );
}
