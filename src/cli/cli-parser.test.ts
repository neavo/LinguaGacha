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

  it("analyze 是未知命令", () => {
    expect(() => parse_cli_args(["analyze"])).toThrow("Unknown command: analyze");
  });

  it.each([
    [["translate"], "Missing required option --input"],
    [
      with_option_value(VALID_TRANSLATE_ARGV, "--target-language", "ALL"),
      "Unsupported target language: ALL",
    ],
    [["translate", "--input", "--output-dir"], "Missing value for --input"],
    [[...VALID_TRANSLATE_ARGV, "--bad", "x"], "Unknown option: --bad"],
    [[...VALID_TRANSLATE_ARGV, "--prompt", "prompt.md"], "--prompt only supports .txt files"],
    [
      [...VALID_TRANSLATE_ARGV, "--text-preserve", "rules.csv"],
      "--text-preserve only supports .json / .xlsx files",
    ],
    [["create"], "Unknown command: create"],
  ] as const)("拒绝无效参数：%s", (argv, message) => {
    expect_usage_error(argv, message);
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

function expect_usage_error(argv: readonly string[], message: string): void {
  let thrown: unknown;
  try {
    parse_cli_args([...argv]);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CLIUsageError);
  expect(thrown).toMatchObject({ message, exitCode: 2 });
}
