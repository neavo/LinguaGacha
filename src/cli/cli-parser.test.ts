import { describe, expect, it } from "vitest";

import { CLIUsageError, parse_cli_args } from "./cli-parser";

describe("parse_cli_args", () => {
  it("无参数和命令级 --help 都只返回帮助请求", () => {
    expect(parse_cli_args([])).toEqual({ kind: "help" });
    expect(parse_cli_args(["translate", "--help"])).toEqual({
      kind: "help",
      command: "translate",
    });
  });

  it("解析 translate 命令的文件进出参数并保留重复 input 顺序", () => {
    expect(
      parse_cli_args([
        "translate",
        "--input",
        "script-a.txt",
        "--input",
        "script-b.txt",
        "--output-dir",
        "out",
        "--source-language",
        "ja",
        "--target-language",
        "zh-hant",
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
          promptPath: null,
          glossaryPath: null,
          preReplacementPath: null,
          postReplacementPath: null,
          textPreservePath: null,
        },
      },
    });
  });

  it("解析 translate 命令的外部资源参数", () => {
    expect(
      parse_cli_args([
        "translate",
        "--input",
        "script.txt",
        "--output-dir",
        "out",
        "--source-language",
        "JA",
        "--target-language",
        "ZH",
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
    ).toMatchObject({
      kind: "command",
      command: {
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

  it("解析 analyze 命令并只允许外部提示词资源", () => {
    expect(
      parse_cli_args([
        "analyze",
        "--input",
        "script.txt",
        "--output-dir",
        "out",
        "--source-language",
        "ALL",
        "--target-language",
        "ZH",
        "--prompt",
        "analysis.txt",
      ]),
    ).toMatchObject({
      kind: "command",
      command: {
        command: "analyze",
        sourceLanguage: "ALL",
        targetLanguage: "ZH",
        resources: {
          promptPath: "analysis.txt",
          glossaryPath: null,
        },
      },
    });
  });

  it.each([
    [["translate"], "Missing required option --input"],
    [
      [
        "translate",
        "--input",
        "script.txt",
        "--output-dir",
        "out",
        "--source-language",
        "JA",
        "--target-language",
        "ALL",
      ],
      "Unsupported target language: ALL",
    ],
    [["translate", "--input", "--output-dir"], "Missing value for --input"],
    [["translate", "--input", "script.txt", "--bad", "x"], "Unknown option: --bad"],
    [
      [
        "analyze",
        "--input",
        "script.txt",
        "--output-dir",
        "out",
        "--source-language",
        "JA",
        "--target-language",
        "ZH",
        "--glossary",
        "g.json",
      ],
      "--glossary is only supported by the translate command",
    ],
    [
      [
        "translate",
        "--input",
        "script.txt",
        "--output-dir",
        "out",
        "--source-language",
        "JA",
        "--target-language",
        "ZH",
        "--prompt",
        "prompt.md",
      ],
      "--prompt only supports .txt files",
    ],
    [
      [
        "translate",
        "--input",
        "script.txt",
        "--output-dir",
        "out",
        "--source-language",
        "JA",
        "--target-language",
        "ZH",
        "--text-preserve",
        "rules.csv",
      ],
      "--text-preserve only supports .json / .xlsx files",
    ],
    [["create"], "Unknown command: create"],
  ] as const)("拒绝无效参数：%s", (argv, message) => {
    expect(() => parse_cli_args([...argv])).toThrow(CLIUsageError);
    expect(() => parse_cli_args([...argv])).toThrow(message);
  });
});
