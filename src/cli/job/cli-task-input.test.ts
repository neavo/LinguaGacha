import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CLICommandName, CLICommandOptions, CLICommandResources } from "../cli-parser";
import { build_cli_task_input } from "./cli-task-input";

const cleanup_roots: string[] = [];

afterEach(() => {
  for (const root of cleanup_roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("build_cli_task_input", () => {
  it("把缺省资源编译为全部关闭的项目任务输入", async () => {
    const input = await build_cli_task_input(create_command());

    expect(index_rules(input.quality_rules)).toEqual({
      glossary: { kind: "glossary", entries: [], enabled: false, mode: null },
      text_preserve: { kind: "text_preserve", entries: [], enabled: null, mode: "off" },
      pre_replacement: { kind: "pre_replacement", entries: [], enabled: false, mode: null },
      post_replacement: { kind: "post_replacement", entries: [], enabled: false, mode: null },
    });
    expect(input.prompts).toEqual([
      { kind: "translation", text: "", enabled: false },
      { kind: "analysis", text: "", enabled: false },
    ]);
  });

  it("按资源类型构建翻译规则并清理提示词 BOM 与空白", async () => {
    const root = create_temp_root();
    const resources = {
      promptPath: write_file(root, "prompt.txt", "\uFEFF 自定义翻译提示词 \n"),
      glossaryPath: write_json(root, "glossary.json", [{ src: "Alice", dst: "爱丽丝" }]),
      preReplacementPath: write_json(root, "pre.json", [{ src: "foo", dst: "bar" }]),
      postReplacementPath: write_json(root, "post.json", [{ src: "旧", dst: "新" }]),
      textPreservePath: write_json(root, "preserve.json", [{ src: "<[^>]+>", regex: true }]),
    };

    const input = await build_cli_task_input(create_command("translate", resources));

    expect(index_rules(input.quality_rules)).toMatchObject({
      glossary: {
        entries: [{ src: "Alice", dst: "爱丽丝" }],
        enabled: true,
        mode: null,
      },
      text_preserve: {
        entries: [{ src: "<[^>]+>", info: "" }],
        enabled: null,
        mode: "custom",
      },
      pre_replacement: {
        entries: [{ src: "foo", dst: "bar" }],
        enabled: true,
        mode: null,
      },
      post_replacement: {
        entries: [{ src: "旧", dst: "新" }],
        enabled: true,
        mode: null,
      },
    });
    for (const rule of input.quality_rules) {
      for (const entry of rule.entries) {
        expect(entry.entry_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/u);
      }
    }
    expect(input.prompts).toEqual([
      { kind: "translation", text: "自定义翻译提示词", enabled: true },
      { kind: "analysis", text: "", enabled: false },
    ]);
  });

  it("分析命令只把外部提示词写入分析槽位", async () => {
    const root = create_temp_root();
    const prompt_path = write_file(root, "analysis.txt", "自定义分析提示词");

    const input = await build_cli_task_input(
      create_command("analyze", { promptPath: prompt_path }),
    );

    expect(input.prompts).toEqual([
      { kind: "translation", text: "", enabled: false },
      { kind: "analysis", text: "自定义分析提示词", enabled: true },
    ]);
  });

  it("质量规则资源含非法正则时拒绝构造任务输入", async () => {
    const root = create_temp_root();
    const pre_replacement_path = write_json(root, "invalid-pre.json", [
      { src: "(", dst: "x", regex: true, case_sensitive: false },
    ]);

    await expect(
      build_cli_task_input(
        create_command("translate", { preReplacementPath: pre_replacement_path }),
      ),
    ).rejects.toThrow("Quality rule regex is invalid.");
  });
});

function create_command(
  command: CLICommandName = "translate",
  resources: Partial<CLICommandResources> = {},
): CLICommandOptions {
  return {
    command,
    inputPaths: ["input.txt"],
    outputDir: "out",
    sourceLanguage: command === "translate" ? "JA" : "ALL",
    targetLanguage: "ZH",
    resources: {
      promptPath: null,
      glossaryPath: null,
      preReplacementPath: null,
      postReplacementPath: null,
      textPreservePath: null,
      ...resources,
    },
  };
}

function index_rules<T extends { kind: string }>(rules: T[]): Record<string, T> {
  return Object.fromEntries(rules.map((rule) => [rule.kind, rule]));
}

function create_temp_root(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-cli-input-"));
  cleanup_roots.push(root);
  return root;
}

function write_file(root: string, name: string, content: string): string {
  const file_path = path.join(root, name);
  fs.writeFileSync(file_path, content, "utf-8");
  return file_path;
}

function write_json(root: string, name: string, value: unknown): string {
  return write_file(root, name, JSON.stringify(value));
}
