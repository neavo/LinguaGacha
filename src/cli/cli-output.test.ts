import { describe, expect, it } from "vitest";

import { build_cli_help } from "./cli-output";

describe("build_cli_help", () => {
  it("全局帮助只展示 help/version 和两个单动词命令", () => {
    const text = build_cli_help(undefined, "win32");

    expect(text).not.toContain("LinguaGacha CLI");
    expect(text).toContain("全局参数 | Global Options:");
    expect(text).toContain("cli.exe translate");
    expect(text).toContain("示例 | Samples:");
    expect(text).toContain("更多说明 | More Info:");
    expect(text).toContain("<文件或目录 | file-or-dir>");
    expect(text).toContain("--help");
    expect(text).toContain("--version");
    expect(text).toContain("translate");
    expect(text).toContain("analyze");
    expect(text).not.toContain("--project");
    expect(text).not.toContain("--watch");
    expect(text).toMatch(/CLIModeEN\n\n$/u);
  });

  it("命令帮助只展示文件进出型参数", () => {
    const text = build_cli_help("translate", "win32");

    expect(text).not.toContain("LinguaGacha CLI");
    expect(text).toContain("用法 | Usage:");
    expect(text).toContain("参数 | Options:");
    expect(text).toContain("示例 | Sample:");
    expect(text).toContain("更多说明 | More Info:");
    expect(text).toContain("--input");
    expect(text).toContain("--output-dir");
    expect(text).toContain("--source-language");
    expect(text).toContain("--target-language");
    expect(text).toContain("--prompt");
    expect(text).toContain("--glossary");
    expect(text).toContain("--pre-replacement");
    expect(text).toContain("--post-replacement");
    expect(text).toContain("--text-preserve");
    expect(text).not.toContain("--open-folder");
    expect(text).toMatch(/CLIModeEN\n\n$/u);
  });

  it("分析命令帮助只展示分析实际支持的外部提示词", () => {
    const text = build_cli_help("analyze", "win32");

    expect(text).toContain("用法 | Usage:");
    expect(text).toContain("参数 | Options:");
    expect(text).toContain("示例 | Sample:");
    expect(text).toContain("更多说明 | More Info:");
    expect(text).toContain("--prompt");
    expect(text).not.toContain("--glossary");
    expect(text).not.toContain("--pre-replacement");
    expect(text).not.toContain("--post-replacement");
    expect(text).not.toContain("--text-preserve");
    expect(text).toMatch(/CLIModeEN\n\n$/u);
  });

  it("macOS 和 Linux 帮助展示主程序 --cli 入口", () => {
    expect(build_cli_help(undefined, "darwin")).toContain("LinguaGacha --cli translate");
    expect(build_cli_help(undefined, "linux")).toContain("LinguaGacha.AppImage --cli translate");
  });
});
