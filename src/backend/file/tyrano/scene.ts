/** 已确认的两种引擎解析语义：旧版逐字符拆分并删除引号内空格，新版用状态机解析参数并支持反斜杠转义。 */
export const TYRANO_PARSERS = ["legacy", "modern"] as const;
export type TyranoParser = (typeof TYRANO_PARSERS)[number];
/** 一个游戏的解析语义，随格式元数据固化。 */
export type SceneSyntax = Readonly<{
  parser: TyranoParser;
  keep_space: string; // 新版 `KeepSpaceInParameterValue`：`1` 删除非反引号值中的空格，`3` 不修剪，其余修剪两端。
}>;
type SceneMode = "text" | "script" | "html"; // 普通文本、`[iscript]` 内的 JavaScript、`[html]` 内的 HTML。
type SceneState = { comment: boolean; script: boolean; html: boolean; block: number }; // 每行保存入口状态，供局部试写复用。

/** 参数值在原稿中的范围，含引号。只有单独解码后与引擎结果一致的参数才登记。 */
type SceneParam = Readonly<{ key: string; start: number; end: number }>;
/** 与引擎 `parseScenario` 输出一一对应的节点，可写文字附带原稿范围。`#` 行对应 `chara_ptext`，`*` 行对应 `label`。 */
export type SceneNode = Readonly<
  | {
      kind: "text";
      value: string;
      start: number;
      end: number;
      line: number;
      mode: SceneMode;
      block: number; // 脚本模式下所属的 `[iscript]` 序号。
    }
  | {
      kind: "tag";
      name: string;
      pm: ReadonlyMap<string, string>;
      params: readonly SceneParam[];
      line: number;
      mode: SceneMode;
    }
  | { kind: "name"; name: string; face: string; start: number; end: number; line: number }
  | { kind: "label"; name: string; title: string; line: number }
>;
/** `start/end` 为不含换行的整行范围，`content` 为去除两端空白和行首 `_` 后的正文起点，`escaped` 表示该行已有 `_`。 */
export type SceneLine = Readonly<{
  start: number;
  end: number;
  content: number;
  escaped: boolean;
  state: Readonly<SceneState>;
}>;

const QUOTES = ['"', "'", "`"]; // 新版引擎接受的三种参数引号。
// 只匹配 `encode_static_text` 生成的形状，数值不带前导零，避免被引擎按八进制求值。
const STATIC_TEXT =
  /^&String\.fromCharCode\((?:(?:0|[1-9]\d*)(?:,(?:0|[1-9]\d*))*)?\)(?:\+String\.fromCharCode\((?:(?:0|[1-9]\d*)(?:,(?:0|[1-9]\d*))*)?\))*$/u;
const STATIC_CHUNK = 4096; // 控制单次调用的参数个数。

/** 按引擎 `parseScenario` 逐行扫描，节点顺序、标签和参数与引擎一致，并附带原稿范围。 */
export function scan_scene(
  text: string,
  syntax: SceneSyntax,
  initial: Readonly<SceneState> = { comment: false, script: false, html: false, block: 0 },
): { nodes: SceneNode[]; lines: SceneLine[] } {
  const state = { ...initial };
  const nodes: SceneNode[] = [];
  const lines: SceneLine[] = [];
  let offset = 0;
  for (const [index, row] of text.split("\n").entries()) {
    const line_start = offset;
    offset += row.length + 1;
    const entry = { ...state };
    let line = row.trim();
    let content = line_start + row.length - row.trimStart().length;
    const mode = (): SceneMode => (state.script ? "script" : state.html ? "html" : "text"); // 引擎优先处理脚本模式。
    /** 标签名决定后续行的解析状态，与引擎 `makeTag` 的副作用一致。 */
    const tag = (raw: string, raw_start: number): void => {
      const { name, pm } = make_tag(raw, syntax);
      nodes.push({
        kind: "tag",
        name,
        pm,
        params: param_ranges(raw, raw_start, pm, syntax),
        line: index,
        mode: mode(),
      });
      if (name === "iscript") {
        state.script = true;
        state.block++;
      } else if (name === "endscript") state.script = false;
      else if (name === "html") state.html = true;
      else if (name === "endhtml") state.html = false;
    };
    let escaped = false;
    if (line.includes("endscript")) state.script = false;
    if (state.comment && line === "*/") state.comment = false;
    else if (line === "/*") state.comment = true;
    else if (state.comment || line.startsWith(";")) {
      // 注释行不产生节点。
    } else if (line.startsWith("#")) {
      const rest = line.slice(1);
      const body = rest.trim();
      const parts = body.split(":");
      const name = parts.length > 1 ? parts[0]! : body;
      const start = content + 1 + rest.length - rest.trimStart().length;
      nodes.push({
        kind: "name",
        name,
        face: parts.length > 1 ? parts[1]! : "",
        start,
        end: start + name.length,
        line: index,
      });
    } else if (line.startsWith("*")) {
      const parts = line.slice(1).split("|");
      nodes.push({
        kind: "label",
        name: parts[0]!.trim(),
        title: (parts[1] ?? "").trim(),
        line: index,
      });
    } else if (line.startsWith("@")) tag(line.slice(1), content + 1);
    else {
      if (line.startsWith("_")) {
        line = line.slice(1);
        content++;
        escaped = true;
      }
      let value = "";
      let segment = 0; // 当前文本片段在本行正文中的起点。
      let tag_start = -1;
      let depth = 0;
      let quote = "";
      let escape = false;
      /** 只登记引擎实际产生的非空文本，范围仍绑定原稿。 */
      const push_text = (end: number): void => {
        if (value)
          nodes.push({
            kind: "text",
            value,
            start: content + segment,
            end: content + end,
            line: index,
            mode: mode(),
            block: state.block,
          });
        value = "";
      };
      for (let j = 0; j < line.length; j++) {
        const c = line[j]!;
        if (syntax.parser === "modern") {
          if (state.script) value += c;
          else if (tag_start >= 0) {
            if (c === "]" && !quote && --depth === 0) {
              tag(line.slice(tag_start + 1, j), content + tag_start + 1);
              tag_start = -1;
              segment = j + 1;
              quote = "";
            } else if (c === "[" && !quote) depth++;
            else if (QUOTES.includes(c)) {
              if (quote === c) quote = "";
              else if (!quote) quote = c;
            }
          } else if (escape) {
            value += c;
            escape = false;
          } else if (c === "[") {
            push_text(j);
            tag_start = j;
            depth = 1;
          } else if (c === "\\") escape = true;
          else value += c;
        } else if (tag_start >= 0) {
          if (c === "]" && !state.script && --depth === 0) {
            tag(line.slice(tag_start + 1, j), content + tag_start + 1);
            tag_start = -1;
            segment = j + 1;
          } else if (c === "[" && !state.script) depth++;
        } else if (c === "[" && !state.script) {
          push_text(j);
          tag_start = j;
          depth = 1;
        } else value += c;
      }
      // 新版补全行尾未闭合的标签，旧版丢弃。
      if (syntax.parser === "modern" && tag_start >= 0 && tag_start + 1 < line.length) {
        const raw = line.slice(tag_start + 1);
        tag(raw.endsWith("]") ? raw.slice(0, -1) : raw, content + tag_start + 1);
      }
      push_text(line.length);
    }
    lines.push({
      start: line_start,
      end: line_start + row.length,
      content,
      escaped,
      state: entry,
    });
  }
  return { nodes, lines };
}

/** 引擎 `makeTag` 的参数语义，输出与引擎 `pm` 一致的键值。 */
function make_tag(raw: string, syntax: SceneSyntax): { name: string; pm: Map<string, string> } {
  const pm = new Map<string, string>();
  if (syntax.parser === "legacy") {
    let quote = "";
    let compact = "";
    let count = 0;
    for (const c of raw) {
      if (quote === "" && (c === '"' || c === "'")) {
        quote = c;
        count = 0;
      } else if (quote === "") compact += c;
      else if (c === quote) {
        quote = "";
        if (count === 0) compact += "undefined";
      } else {
        compact += c === "=" ? "#" : c === " " ? "" : c; // 引号内的等号暂存为 `#`，空格被删除。
        count++;
      }
    }
    const parts = compact.split(" ");
    const name = parts[0]!.trim(); // 引擎在合并等号前读取标签名。
    for (let k = 1; k < parts.length; k++) {
      const part = parts[k]!;
      if (part === "") parts.splice(k--, 1);
      else if (part === "=") {
        if (parts[k - 1] && parts[k + 1]) {
          parts[k - 1] = parts[k - 1] + "=" + parts[k + 1];
          parts.splice(k--, 2);
        }
      } else if (part.startsWith("=")) {
        if (parts[k - 1]) {
          parts[k - 1] = parts[k - 1] + part;
          parts.splice(k, 1);
        }
      } else if (part.endsWith("=") && parts[k + 1]) {
        parts[k] = part + parts[k + 1];
        parts.splice(k + 1, 1);
      }
    }
    for (const part of parts.slice(1)) {
      const pair = part.trim().split("=");
      const key = pair[0]!.trim();
      const value = (pair[1] ?? "").trim();
      if (key === "*") pm.set("*", "");
      if (value !== "") pm.set(key, value.replaceAll("#", "="));
      if (value === "undefined") pm.set(key, "");
    }
    return { name, pm };
  }
  let state: "name" | "key" | "equal" | "quote" | "value" = "name";
  let name = "";
  let key = "";
  let value = "";
  let end = "";
  let escape = false; // 引擎在整个标签内共用该标志，转义后直到遇到结束符才复位。
  /** 参数结束时按配置修剪空白，保留引擎对 `undefined` 的处理顺序。 */
  const commit = (): void => {
    const trimmed = value.trim();
    pm.set(key, syntax.keep_space !== "3" ? trimmed : trimmed === "undefined" ? "" : value);
  };
  for (const c of raw) {
    if (state === "name") {
      if (c !== " ") name += c;
      else if (name) state = "key";
    } else if (state === "key") {
      if (c === " ") {
        if (key) state = "equal";
      } else if (c === "=") state = "quote";
      else key += c;
    } else if (state === "equal") {
      if (c === "=") state = "quote";
      else if (c !== " ") {
        pm.set(key, "");
        key = c;
        state = "key";
      }
    } else if (state === "quote") {
      if (QUOTES.includes(c)) {
        end = c;
        state = "value";
      } else if (c !== " ") {
        end = " ";
        value = c;
        state = "value";
      }
    } else if (c === end) {
      if (escape) {
        escape = false;
        value += c;
      } else {
        commit();
        key = value = end = "";
        state = "key";
      }
    } else {
      const char = end !== "`" && c === " " && syntax.keep_space === "1" ? "" : c;
      if (escape) value += char;
      else if (char === "\\") escape = true;
      else value += char;
    }
  }
  if (key !== "") commit();
  return { name, pm };
}

/** 逐个切出参数值范围，再以单独解码复核，确保改写范围就是引擎读取的值。 */
function param_ranges(
  raw: string,
  raw_start: number,
  pm: ReadonlyMap<string, string>,
  syntax: SceneSyntax,
): SceneParam[] {
  const ranges = new Map<string, SceneParam>(); // 同名参数以最后一次为准，与引擎一致。
  let i = 0;
  /** 引擎只把半角空格当作参数分隔符。 */
  const skip = (): void => {
    while (raw[i] === " ") i++;
  };
  skip();
  while (i < raw.length && raw[i] !== " ") i++;
  while (i < raw.length) {
    skip();
    const key_start = i;
    while (i < raw.length && raw[i] !== " " && raw[i] !== "=") i++;
    const key = raw.slice(key_start, i);
    skip();
    if (raw[i] !== "=") continue;
    i++;
    skip();
    const start = i;
    const quote = raw[i]!;
    if (quote === '"' || quote === "'" || (quote === "`" && syntax.parser === "modern")) {
      i++;
      while (i < raw.length && raw[i] !== quote)
        i += syntax.parser === "modern" && raw[i] === "\\" ? 2 : 1;
      i = Math.min(i + 1, raw.length);
    } else while (i < raw.length && raw[i] !== " ") i++;
    if (key) ranges.set(key, { key, start: raw_start + start, end: raw_start + i });
  }
  return [...ranges.values()].filter(
    (range) =>
      pm.has(range.key) &&
      make_tag("_ k=" + raw.slice(range.start - raw_start, range.end - raw_start), syntax).pm.get(
        "k",
      ) === pm.get(range.key),
  );
}

/** 静态字符表达式在所有支持实体的位置无损表示任意文本，并且不含空格、引号和方括号。 */
export function encode_static_text(value: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += STATIC_CHUNK) {
    const chunk = value.slice(i, i + STATIC_CHUNK);
    const codes = Array.from({ length: chunk.length }, (_, unit) => chunk.charCodeAt(unit));
    chunks.push("String.fromCharCode(" + codes.join(",") + ")");
  }
  return "&" + (chunks.join("+") || "String.fromCharCode()");
}

/** 只解码本产品生成形状的表达式，其他实体仍是代码。 */
export function decode_static_text(value: string): string | null {
  if (!STATIC_TEXT.test(value)) return null;
  let text = "";
  for (const [, list] of value.matchAll(/\(([^)]*)\)/gu)) {
    for (const code of list ? list.split(",").map(Number) : []) {
      if (code > 0xffff) return null;
      text += String.fromCharCode(code);
    }
  }
  return text;
}

/** 运行时取值：`=` 为字面文本，`~` 为表达式或宏参数引用。`entity` 表示该位置会展开 `&`、`%` 前缀。 */
export function runtime_value(value: string, entity: boolean): string {
  if (!entity) return "=" + value;
  const decoded = decode_static_text(value);
  if (decoded !== null) return "=" + decoded;
  return /^[&%]/u.test(value) ? "~" + value : "=" + value;
}

/** `[text val=…]` 是编码后的正文，运行时与普通正文节点等价。 */
function text_tag_value(node: SceneNode): string | undefined {
  return node.kind === "tag" && node.name === "text" && node.pm.size === 1
    ? node.pm.get("val")
    : undefined;
}

/** 存档按场景节点序号恢复，因此逐节点保留控制顺序和跳转标签位置。 */
export function scene_structure(nodes: readonly SceneNode[]): string[][] {
  return nodes.map((node) =>
    node.kind === "text"
      ? ["text", node.mode]
      : node.kind === "tag"
        ? text_tag_value(node) === undefined
          ? ["tag", node.name, node.mode]
          : ["text", node.mode]
        : node.kind === "name"
          ? ["name"]
          : ["label", node.name, node.title],
  );
}

/** 运行时取值：正文、姓名与标签参数。脚本文本的内容由 JavaScript 字符串编码负责，这里不比较。 */
export function scene_values(
  nodes: readonly SceneNode[],
  syntax: SceneSyntax,
): (string | string[] | string[][] | null)[] {
  return nodes.map((node) => {
    const text = text_tag_value(node);
    return text !== undefined
      ? runtime_value(text, true)
      : node.kind === "text"
        ? node.mode === "script"
          ? null
          : runtime_value(node.value, syntax.parser === "legacy")
        : node.kind === "tag"
          ? [...node.pm].map(([key, value]) => [key, runtime_value(value, true)]).sort()
          : node.kind === "name"
            ? [runtime_value(node.name, true), node.face]
            : null;
  });
}
