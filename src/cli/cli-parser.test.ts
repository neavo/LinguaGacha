import { describe, expect, it } from "vitest";

import { CLIUsageError, parse_cli_args } from "./cli-parser";

const VALID_TRANSLATE_ARGV = [
  "translate",
  "--input",
  "script-a.txt",
  "--output-dir",
  "out",
  "--source-language",
  "ja",
  "--target-language",
  "zh-hant",
] as const;

describe("parse_cli_args", () => {
  it("无参数和命令级 --help 都返回帮助请求", () => {
    expect(parse_cli_args([])).toEqual({ kind: "help" });
    expect(parse_cli_args(["translate", "--help"])).toEqual({
      kind: "help",
      command: "translate",
    });
  });

  it("解析 translate 参数、资源并保留重复 input 顺序", () => {
    expect(
      parse_cli_args([
        ...VALID_TRANSLATE_ARGV,
        "--input",
        "script-b.txt",
        "--prompt",
        "prompt.txt",
        "--glossary",
        "glossary.json",
        "--pre-replacement",
        "pre.xlsx",
        "--post-replacement",
        "post.json",
        "--text-preserve",
        "preserve.xlsx",
      ]),
    ).toEqual({
      kind: "command",
      command: {
        command: "translate",
        inputPaths: ["script-a.txt", "script-b.txt"],
        outputDir: "out",
        sourceLanguage: "JA",
        targetLanguage: "ZH-HANT",
        resources: {
          promptPath: "prompt.txt",
          glossaryPath: "glossary.json",
          preReplacementPath: "pre.xlsx",
          postReplacementPath: "post.json",
          textPreservePath: "preserve.xlsx",
        },
      },
    });
  });

  it.each([
    ["缺少必填参数", ["translate"]],
    ["非法目标语言", with_option_value(VALID_TRANSLATE_ARGV, "--target-language", "ALL")],
    ["选项缺少值", ["translate", "--input", "--output-dir"]],
    ["未知选项", [...VALID_TRANSLATE_ARGV, "--bad", "x"]],
    ["错误提示词格式", [...VALID_TRANSLATE_ARGV, "--prompt", "prompt.md"]],
    ["错误规则格式", [...VALID_TRANSLATE_ARGV, "--text-preserve", "rules.csv"]],
    ["未知命令", ["create"]],
  ] as const)("拒绝%s并返回 usage 退出码", (_name, argv) => {
    let thrown: unknown;
    try {
      parse_cli_args([...argv]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CLIUsageError);
    expect(thrown).toMatchObject({ exitCode: 2 });
  });
});

function with_option_value(
  argv: readonly string[],
  option: string,
  value: string,
): readonly string[] {
  const result = [...argv];
  result[result.indexOf(option) + 1] = value;
  return result;
}
