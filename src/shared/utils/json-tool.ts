/**
 * JsonValue 是跨 main / renderer / worker 传递结构化载荷时的最小公共形状
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JsonRecord 用于边界快照，调用方必须按值复制，不能共享可变领域对象
 */
export type JsonRecord = Record<string, JsonValue>;

/**
 * MutableJsonRecord 只表示当前构建中的 JSON 字典，离开构建函数后仍按普通值对象流通
 */
export type MutableJsonRecord = Record<string, JsonValue>;

/**
 * JSON 工具可接受的文本来源，统一覆盖字符串和二进制读取结果
 */
export type JsonToolTextInput = string | ArrayBuffer | Uint8Array;

/**
 * 控制 JSON 写出格式，避免调用方直接散落缩进魔术值
 */
export interface JsonToolStringifyOptions {
  indent?: number;
}

/**
 * UTF-8 BOM 常量集中在工具内，避免各调用点重复处理文件头
 */
const UTF8_BOM = "\uFEFF";

/**
 * 将字符串或二进制输入解码为无 BOM 文本，保持后续 JSON 解析入口纯净
 */
function decode_text(input: JsonToolTextInput): string {
  const text =
    typeof input === "string"
      ? input
      : input instanceof ArrayBuffer
        ? new TextDecoder("utf-8").decode(new Uint8Array(input))
        : new TextDecoder("utf-8").decode(input);
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/**
 * 将 Python 标准库兼容的非有限数字令牌转成 JSON 可解析哨兵，保持损坏 JSON 仍按严格路径抛错
 */
function replace_non_finite_tokens(text: string): string {
  let result = "";
  let in_string = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (in_string) {
      result += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        in_string = false;
      }
      continue;
    }

    if (char === '"') {
      in_string = true;
      result += char;
      continue;
    }

    const rest = text.slice(index);
    const matched = rest.match(/^-?Infinity|^NaN/);
    if (
      matched !== null &&
      is_json_token_boundary(text[index - 1]) &&
      is_json_token_boundary(text[index + matched[0].length])
    ) {
      result += `{"__linguagacha_non_finite_json_number__":${JSON.stringify(matched[0])}}`;
      index += matched[0].length - 1;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * 非有限数字只允许出现在 JSON 值边界，避免误伤字符串外的普通标识残片
 */
function is_json_token_boundary(char: string | undefined): boolean {
  return char === undefined || /[\s,[\]{}:]/.test(char);
}

/**
 * 还原非有限数字哨兵对象，对齐 Python json.loads 对 NaN/Infinity 的兼容行为
 */
function revive_non_finite_numbers(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    "__linguagacha_non_finite_json_number__" in value
  ) {
    const token = (value as { __linguagacha_non_finite_json_number__: string })[
      "__linguagacha_non_finite_json_number__"
    ];
    if (token === "NaN") {
      return Number.NaN;
    }
    if (token === "Infinity") {
      return Number.POSITIVE_INFINITY;
    }
    if (token === "-Infinity") {
      return Number.NEGATIVE_INFINITY;
    }
  }
  return value;
}

/**
 * 集中 JSON 解析、修复和序列化，文件读写由各运行态平台层负责
 */
export class JsonTool {
  /**
   * 解析 JSON，并在严格解析失败时仅兼容 Python 标准库接受的非有限数字
   */
  public static loads<value_type = unknown>(input: JsonToolTextInput): value_type {
    const text = decode_text(input);
    try {
      return JSON.parse(text) as value_type;
    } catch (error) {
      try {
        return JSON.parse(replace_non_finite_tokens(text), revive_non_finite_numbers) as value_type;
      } catch {
        throw error;
      }
    }
  }

  /**
   * 保留既有严格入口名，实际解析规则与 loads 一致，避免调用点分裂出第二套兼容策略
   */
  public static parseStrict<value_type = unknown>(input: JsonToolTextInput): value_type {
    return this.loads<value_type>(input);
  }

  /**
   * 序列化为 JSON 文本，默认使用紧凑格式
   */
  public static dumps(value: unknown, options: JsonToolStringifyOptions = {}): string {
    return this.stringifyStrict(value, options);
  }

  /**
   * 序列化为 UTF-8 bytes，便于调用方直接写入二进制文件
   */
  public static dumpsBytes(value: unknown, options: JsonToolStringifyOptions = {}): Buffer {
    return Buffer.from(this.stringifyStrict(value, options), "utf-8");
  }

  /**
   * 严格序列化 JSON，确保写盘前能暴露不可序列化值
   */
  public static stringifyStrict(value: unknown, options: JsonToolStringifyOptions = {}): string {
    const indent = options.indent ?? 0;
    const text = indent > 0 ? JSON.stringify(value, null, indent) : JSON.stringify(value);
    if (text === undefined) {
      throw new TypeError("JSON 序列化结果为空。");
    }
    return text;
  }

  /**
   * 尝试修复并解析 JSON，兼容模型返回的非标准片段
   */
  public static async repairParse<value_type = unknown>(
    input: JsonToolTextInput,
  ): Promise<value_type> {
    try {
      return this.parseStrict<value_type>(input);
    } catch {
      const { jsonrepair } = await import("jsonrepair");
      return this.parseStrict<value_type>(jsonrepair(decode_text(input)));
    }
  }

  /**
   * 尝试修复并解析 JSON，保留 Py 侧工具命名的对应入口
   */
  public static async repairLoads<value_type = unknown>(
    input: JsonToolTextInput,
  ): Promise<value_type> {
    return await this.repairParse<value_type>(input);
  }
}
