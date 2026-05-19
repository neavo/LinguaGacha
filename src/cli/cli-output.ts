import type { CLICommandName } from "./cli-parser";

/**
 * 构造全局帮助文本，入口名按平台展示真实可用的 CLI 调用方式。
 */
function build_global_help_text(executable_name: string): string {
  return `全局参数 | Global Options:
  --help                 显示帮助 | Show help
  --version              显示版本 | Show version

命令 | Commands:
  analyze                执行分析任务 | Run analysis task
  translate              执行翻译任务 | Run translation task

示例 | Samples:
  ${executable_name} analyze   --input <文件或目录 | file-or-dir> --output-dir <目录 | dir> --source-language <语言码 | code> --target-language <语言码 | code>
  ${executable_name} translate --input <文件或目录 | file-or-dir> --output-dir <目录 | dir> --source-language <语言码 | code> --target-language <语言码 | code>

更多说明 | More Info:
  https://github.com/neavo/LinguaGacha/wiki/CLIMode
  https://github.com/neavo/LinguaGacha/wiki/CLIModeEN

`;
}

/**
 * 构造单命令帮助文本，只暴露该命令实际支持的文件进出参数。
 */
function build_command_help_text(command: CLICommandName, executable_name: string): string {
  if (command === "translate") {
    return `用法 | Usage:
  ${executable_name} translate --input <文件或目录 | file-or-dir> --output-dir <目录 | dir> --source-language <语言码 | code> --target-language <语言码 | code>

参数 | Options:
  --input                必填，可重复；文件或目录 | Required, repeatable; file or directory
  --output-dir           必填；输出目录 | Required; output directory
  --source-language      必填；允许 ALL | Required; allows ALL
  --target-language      必填；不允许 ALL | Required; does not allow ALL
  --prompt               可选；.txt 翻译提示词 | Optional; .txt translation prompt
  --glossary             可选；.json / .xlsx 术语表 | Optional; .json / .xlsx glossary
  --pre-replacement      可选；.json / .xlsx 译前替换规则 | Optional; .json / .xlsx pre-translation replacements
  --post-replacement     可选；.json / .xlsx 译后替换规则 | Optional; .json / .xlsx post-translation replacements
  --text-preserve        可选；.json / .xlsx 文本保护规则 | Optional; .json / .xlsx text preserve rules

示例 | Sample:
  ${executable_name} translate --input ./game --output-dir ./out --source-language JA --target-language ZH

更多说明 | More Info:
  https://github.com/neavo/LinguaGacha/wiki/CLIMode
  https://github.com/neavo/LinguaGacha/wiki/CLIModeEN

`;
  }

  return `用法 | Usage:
  ${executable_name} analyze --input <文件或目录 | file-or-dir> --output-dir <目录 | dir> --source-language <语言码 | code> --target-language <语言码 | code>

参数 | Options:
  --input                必填，可重复；文件或目录 | Required, repeatable; file or directory
  --output-dir           必填；输出 glossary 文件的目录 | Required; directory for glossary files
  --source-language      必填；允许 ALL | Required; allows ALL
  --target-language      必填；不允许 ALL | Required; does not allow ALL
  --prompt               可选；.txt 分析提示词 | Optional; .txt analysis prompt

示例 | Sample:
  ${executable_name} analyze --input ./game --output-dir ./glossary --source-language JA --target-language ZH

更多说明 | More Info:
  https://github.com/neavo/LinguaGacha/wiki/CLIMode
  https://github.com/neavo/LinguaGacha/wiki/CLIModeEN

`;
}

/**
 * 输出 CLI 帮助文本；命令帮助只展示当前命令需要的参数。
 */
export function build_cli_help(
  command?: CLICommandName,
  platform: NodeJS.Platform = process.platform,
): string {
  const executable_name = resolve_cli_executable_name(platform);
  return command === undefined
    ? build_global_help_text(executable_name)
    : build_command_help_text(command, executable_name);
}

/**
 * Windows 有轻量 cli.exe；macOS 与 Linux 直接通过主程序显式 --cli 进入命令模式。
 */
function resolve_cli_executable_name(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "cli.exe";
  }
  if (platform === "darwin") {
    return "LinguaGacha --cli";
  }
  return "LinguaGacha.AppImage --cli";
}

/**
 * stdout 写入口集中在这里，方便测试替换并保持换行语义一致。
 */
export function write_stdout(message: string): void {
  process.stdout.write(message.endsWith("\n") ? message : `${message}\n`);
}

/**
 * stderr 写入口集中在这里，错误路径不混入业务服务。
 */
export function write_stderr(message: string): void {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}
