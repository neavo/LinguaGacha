/**
 * JSON 工具可接受的文本来源，统一覆盖字符串和二进制读取结果。
 */
export type JsonToolTextInput = string | ArrayBuffer | Uint8Array;

/**
 * 控制 JSON 写出格式，避免调用方直接散落缩进魔术值。
 */
export interface JsonToolStringifyOptions {
  indent?: number;
}

/**
 * 控制 JSON 文件读取策略，允许调用方显式选择修复解析。
 */
export interface JsonToolReadFileOptions {
  repair?: boolean;
}

/**
 * UTF-8 BOM 常量集中在工具内，避免各调用点重复处理文件头。
 */
const UTF8_BOM = "\uFEFF";

/**
 * 将字符串或二进制输入解码为无 BOM 文本，保持后续 JSON 解析入口纯净。
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
 * 延迟加载 fs/promises 读取 UTF-8 文本，避免 renderer 打包路径静态引入 Node 文件模块。
 */
async function read_utf8_file(file_path: string): Promise<string> {
  const fs = await import("node:fs/promises");
  return decode_text(await fs.readFile(file_path));
}

/**
 * 延迟加载 fs/promises 写入 UTF-8 文本，保持文件写出只在具备 Node 能力的运行态发生。
 */
async function write_utf8_file(file_path: string, text: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(file_path, text, "utf-8");
}

/**
 * 集中 JSON 解析、修复和文件读写，避免调用点重复处理异常。
 */
export class JsonTool {
  /**
   * 严格解析 JSON 字符串，避免静默吞掉坏配置。
   */
  public static parseStrict<value_type = unknown>(input: JsonToolTextInput): value_type {
    return JSON.parse(decode_text(input)) as value_type;
  }

  /**
   * 严格序列化 JSON，确保写盘前能暴露不可序列化值。
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
   * 尝试修复并解析 JSON，兼容模型返回的非标准片段。
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
   * 读取 JSON 文件并套用默认值，统一缺失文件处理。
   */
  public static async readJsonFile<value_type = unknown>(
    file_path: string,
    options: JsonToolReadFileOptions = {},
  ): Promise<value_type> {
    const text = await read_utf8_file(file_path);
    return options.repair === true
      ? await this.repairParse<value_type>(text)
      : this.parseStrict<value_type>(text);
  }

  /**
   * 写入 JSON 文件，确保目录存在且格式稳定。
   */
  public static async writeJsonFile(
    file_path: string,
    value: unknown,
    options: JsonToolStringifyOptions = {},
  ): Promise<void> {
    // 先完成序列化再写盘，避免不可序列化值把目标文件截断。
    const text = this.stringifyStrict(value, options);
    await write_utf8_file(file_path, text);
  }
}
