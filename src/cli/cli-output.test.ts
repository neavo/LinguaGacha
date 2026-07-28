import { describe, expect, it } from "vitest";

import { build_cli_help } from "./cli-output";

describe("build_cli_help", () => {
  it("全局帮助展示全局参数、两个命令与 Windows 入口", () => {
    const text = build_cli_help(undefined, "win32");

    for (const item of ["--help", "--version", "translate", "analyze", "cli.exe translate"]) {
      expect(text).toContain(item);
    }
  });

  it("命令帮助只展示对应资源参数", () => {
    const translate_help = build_cli_help("translate", "win32");
    const analyze_help = build_cli_help("analyze", "win32");

    for (const option of [
      "--input",
      "--output-dir",
      "--source-language",
      "--target-language",
      "--prompt",
    ]) {
      expect(translate_help).toContain(option);
      expect(analyze_help).toContain(option);
    }
    for (const option of [
      "--glossary",
      "--pre-replacement",
      "--post-replacement",
      "--text-preserve",
    ]) {
      expect(translate_help).toContain(option);
      expect(analyze_help).not.toContain(option);
    }
  });

  it("macOS 和 Linux 帮助展示主程序 --cli 入口", () => {
    expect(build_cli_help(undefined, "darwin")).toContain("LinguaGacha --cli translate");
    expect(build_cli_help(undefined, "linux")).toContain("LinguaGacha.AppImage --cli translate");
  });
});
