import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettingService } from "../app/app-setting-service";
import { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";
import { default_native_fs } from "../../native/native-fs";
import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectDefaultPresetReader } from "./project-default-preset-reader";

type MutableJsonRecord = Record<string, unknown>;

describe("ProjectDefaultPresetReader", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { force: true, recursive: true });
    }
    vi.restoreAllMocks();
  });

  it("把质量规则和提示词预设读取为显式项目输入", () => {
    const app_root = create_temp_dir();
    write_file(
      path.join(app_root, "resource", "glossary", "preset", "base.json"),
      JsonTool.stringifyStrict([{ src: "勇者", dst: "Hero" }]),
    );
    write_file(
      path.join(app_root, "resource", "translation_prompt", "preset", "base.txt"),
      "\uFEFF翻译提示词\n",
    );
    const log_manager = create_log_manager();
    const reader = create_reader({
      app_root,
      log_manager,
      config: {
        glossary_default_preset: "builtin:base.json",
        translation_custom_prompt_default_preset: "builtin:base.txt",
      },
    });

    const input = reader.read();
    reader.log_loaded_names(input.loaded_names);

    expect(input).toEqual({
      text_preserve_mode: "smart",
      quality_rules: [
        {
          kind: "glossary",
          entries: [{ src: "勇者", dst: "Hero" }],
          enabled: true,
          mode: null,
        },
      ],
      prompts: [
        {
          kind: "translation",
          text: "翻译提示词",
          enabled: true,
        },
      ],
      loaded_names: ["术语表", "翻译提示词"],
    });
    expect(log_manager.info).toHaveBeenCalledWith("已自动加载默认预设：术语表 | 翻译提示词 …", {
      source: "project-lifecycle",
    });
  });

  it("文本保护预设显式声明 custom 模式", () => {
    const app_root = create_temp_dir();
    write_file(
      path.join(app_root, "resource", "text_preserve", "preset", "base.json"),
      JsonTool.stringifyStrict([{ src: "\\[[^\\]]+\\]" }]),
    );
    const reader = create_reader({
      app_root,
      log_manager: create_log_manager(),
      config: { text_preserve_default_preset: "builtin:base.json" },
    });

    const input = reader.read();

    expect(input.quality_rules).toEqual([
      {
        kind: "text_preserve",
        entries: [{ src: "\\[[^\\]]+\\]" }],
        enabled: null,
        mode: "custom",
      },
    ]);
  });

  it("单个预设读取失败只记录诊断并保留其余初始输入", () => {
    const app_root = create_temp_dir();
    const log_manager = create_log_manager();
    const reader = create_reader({
      app_root,
      log_manager,
      config: { glossary_default_preset: "builtin:missing.json" },
    });

    const input = reader.read();

    expect(input).toEqual({
      text_preserve_mode: "smart",
      quality_rules: [],
      prompts: [],
      loaded_names: [],
    });
    expect(log_manager.warning).toHaveBeenCalledWith(
      "默认质量规则预设加载失败 …",
      expect.objectContaining({
        context: {
          preset_directory: "glossary",
          virtual_id: "builtin:missing.json",
        },
        source: "project-lifecycle",
      }),
    );
  });

  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-default-preset-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  function write_file(file_path: string, content: string): void {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, "utf-8");
  }

  function create_reader(options: {
    app_root: string;
    config: MutableJsonRecord;
    log_manager: LogManager;
  }): ProjectDefaultPresetReader {
    return new ProjectDefaultPresetReader(
      {
        read_setting: vi.fn(() => options.config),
      } as unknown as AppSettingService,
      new AppPathService({ appRoot: options.app_root }),
      options.log_manager,
      default_native_fs,
    );
  }

  function create_log_manager(): LogManager & {
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  } {
    return {
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    } as unknown as LogManager & {
      info: ReturnType<typeof vi.fn>;
      warning: ReturnType<typeof vi.fn>;
    };
  }
});
