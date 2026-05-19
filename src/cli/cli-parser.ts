import {
  ALL_LANGUAGE_CODE,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  normalize_language_code,
  type SourceLanguageCode,
  type TargetLanguageCode,
} from "../shared/language";

export type CLICommandName = "translate" | "analyze";

export type CLIParseResult =
  | { kind: "help"; command?: CLICommandName }
  | { kind: "version" }
  | { kind: "command"; command: CLICommandOptions };

export interface CLICommandOptions {
  command: CLICommandName;
  inputPaths: string[]; // inputPaths 保留用户输入顺序，文件域会进一步过滤支持格式
  outputDir: string; // outputDir 是 CLI 唯一输出位置，任务产物会覆盖同名文件
  sourceLanguage: SourceLanguageCode | typeof ALL_LANGUAGE_CODE;
  targetLanguage: TargetLanguageCode;
  resources: CLICommandResources; // resources 只接受本次 CLI 外部文件，不读取 GUI 默认预设
}

export interface CLICommandResources {
  promptPath: string | null; // promptPath 按命令写入 translation_prompt 或 analysis_prompt
  glossaryPath: string | null; // glossaryPath 仅服务翻译任务术语表
  preReplacementPath: string | null; // preReplacementPath 仅服务翻译任务译前替换
  postReplacementPath: string | null; // postReplacementPath 仅服务翻译任务译后替换
  textPreservePath: string | null; // textPreservePath 仅服务翻译任务自定义文本保护
}

export class CLIUsageError extends Error {
  public readonly exitCode = 2; // 2 表示命令行参数错误，和常见 CLI 约定对齐

  /**
   * usage 错误只承载给用户看的短信息，不包装内部异常。
   */
  public constructor(message: string) {
    super(message);
    this.name = "CLIUsageError";
  }
}

const COMMANDS = new Set<CLICommandName>(["translate", "analyze"]);
const SOURCE_LANGUAGE_SET = new Set<string>([ALL_LANGUAGE_CODE, ...SOURCE_LANGUAGE_CODES]);
const TARGET_LANGUAGE_SET = new Set<string>(TARGET_LANGUAGE_CODES);

/**
 * 解析第一阶段 CLI 参数；全局只保留 help/version，业务参数全部挂在命令下。
 */
export function parse_cli_args(argv: string[]): CLIParseResult {
  const tokens = [...argv];
  const first_token = tokens.shift();
  if (first_token === undefined || first_token === "--help") {
    return { kind: "help" };
  }
  if (first_token === "--version") {
    return { kind: "version" };
  }
  if (!is_cli_command_name(first_token)) {
    throw new CLIUsageError(`Unknown command: ${first_token}`);
  }
  if (tokens.includes("--help")) {
    return { kind: "help", command: first_token };
  }
  return { kind: "command", command: parse_command_options(first_token, tokens) };
}

/**
 * 判断命令名，CLI 只接受单一动词命令。
 */
function is_cli_command_name(value: string): value is CLICommandName {
  return COMMANDS.has(value as CLICommandName);
}

/**
 * 将命令参数收窄成 job 输入；重复 --input 会被保留，后续文件域按路径身份去重。
 */
function parse_command_options(command: CLICommandName, tokens: string[]): CLICommandOptions {
  const input_paths: string[] = [];
  let output_dir = "";
  let source_language = "";
  let target_language = "";
  const resources = create_empty_command_resources();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const value = tokens[index + 1];
    if (token === "--input") {
      input_paths.push(read_option_value(token, value));
      index += 1;
    } else if (token === "--output-dir") {
      output_dir = read_option_value(token, value);
      index += 1;
    } else if (token === "--source-language") {
      source_language = read_option_value(token, value);
      index += 1;
    } else if (token === "--target-language") {
      target_language = read_option_value(token, value);
      index += 1;
    } else if (token === "--prompt") {
      resources.promptPath = normalize_resource_path(read_option_value(token, value), token, [
        ".txt",
      ]);
      index += 1;
    } else if (token === "--glossary") {
      assert_translation_only_option(command, token);
      resources.glossaryPath = normalize_resource_path(read_option_value(token, value), token, [
        ".json",
        ".xlsx",
      ]);
      index += 1;
    } else if (token === "--pre-replacement") {
      assert_translation_only_option(command, token);
      resources.preReplacementPath = normalize_resource_path(
        read_option_value(token, value),
        token,
        [".json", ".xlsx"],
      );
      index += 1;
    } else if (token === "--post-replacement") {
      assert_translation_only_option(command, token);
      resources.postReplacementPath = normalize_resource_path(
        read_option_value(token, value),
        token,
        [".json", ".xlsx"],
      );
      index += 1;
    } else if (token === "--text-preserve") {
      assert_translation_only_option(command, token);
      resources.textPreservePath = normalize_resource_path(read_option_value(token, value), token, [
        ".json",
        ".xlsx",
      ]);
      index += 1;
    } else {
      throw new CLIUsageError(`Unknown option: ${token}`);
    }
  }

  return {
    command,
    inputPaths: require_non_empty_list(input_paths, "--input"),
    outputDir: require_non_empty_text(output_dir, "--output-dir"),
    sourceLanguage: normalize_source_language(source_language),
    targetLanguage: normalize_target_language(target_language),
    resources,
  };
}

/**
 * CLI 资源默认全部关闭，只有显式传入外部文件才写入临时工程。
 */
function create_empty_command_resources(): CLICommandResources {
  return {
    promptPath: null,
    glossaryPath: null,
    preReplacementPath: null,
    postReplacementPath: null,
    textPreservePath: null,
  };
}

/**
 * 分析任务当前只支持自定义提示词，翻译专属规则不能静默忽略。
 */
function assert_translation_only_option(command: CLICommandName, option_name: string): void {
  if (command !== "translate") {
    throw new CLIUsageError(`${option_name} is only supported by the translate command`);
  }
}

/**
 * 资源路径只做语法和扩展名收窄，真实存在性留给 job 文件边界统一检查。
 */
function normalize_resource_path(
  value: string,
  option_name: string,
  extensions: readonly string[],
): string {
  const normalized_value = require_non_empty_text(value, option_name);
  const lower_value = normalized_value.toLowerCase();
  if (!extensions.some((extension) => lower_value.endsWith(extension))) {
    throw new CLIUsageError(`${option_name} only supports ${extensions.join(" / ")} files`);
  }
  return normalized_value;
}

/**
 * 读取带值参数，避免把下一个参数名误当作值。
 */
function read_option_value(option_name: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new CLIUsageError(`Missing value for ${option_name}`);
  }
  return value.trim();
}

/**
 * 列表型参数至少出现一次，空字符串输入不进入 job。
 */
function require_non_empty_list(values: string[], option_name: string): string[] {
  const normalized_values = values.map((value) => value.trim()).filter((value) => value !== "");
  if (normalized_values.length === 0) {
    throw new CLIUsageError(`Missing required option ${option_name}`);
  }
  return normalized_values;
}

/**
 * 文本型参数必须提供非空值。
 */
function require_non_empty_text(value: string, option_name: string): string {
  const normalized_value = value.trim();
  if (normalized_value === "") {
    throw new CLIUsageError(`Missing required option ${option_name}`);
  }
  return normalized_value;
}

/**
 * 源语言允许 ALL，其他值必须属于源语言列表。
 */
function normalize_source_language(value: string): SourceLanguageCode | typeof ALL_LANGUAGE_CODE {
  const language = normalize_language_code(value);
  if (language !== null && SOURCE_LANGUAGE_SET.has(language)) {
    return language as SourceLanguageCode | typeof ALL_LANGUAGE_CODE;
  }
  throw new CLIUsageError(`Unsupported source language: ${value}`);
}

/**
 * 目标语言不允许 ALL，必须属于目标语言列表。
 */
function normalize_target_language(value: string): TargetLanguageCode {
  const language = normalize_language_code(value);
  if (language !== null && TARGET_LANGUAGE_SET.has(language)) {
    return language as TargetLanguageCode;
  }
  throw new CLIUsageError(`Unsupported target language: ${value}`);
}
