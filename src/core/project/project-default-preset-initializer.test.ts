import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettingService } from "../app/app-setting-service";
import { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";
import { default_native_fs } from "../../native/native-fs";
import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectDefaultPresetInitializer } from "./project-default-preset-initializer";

type MutableJsonRecord = Record<string, unknown>;

describe("ProjectDefaultPresetInitializer", () => {
  const cleanup_paths: string[] = []; // 默认预设测试创建真实资源目录，统一清理避免污染用户工作区

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { force: true, recursive: true });
    }
    vi.restoreAllMocks();
  });

  it("根据用户默认预设配置生成新建工程初始化操作并记录成功加载名称", () => {
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
    const initializer = create_initializer({
      app_root,
      log_manager,
      config: {
        glossary_default_preset: "builtin:base.json",
        translation_custom_prompt_default_preset: "builtin:base.txt",
      },
    });

    const result = initializer.build_operations("E:/demo/project.lg");
    initializer.log_loaded_names(result.loaded_names);

    expect(result.operations).toEqual([
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "text_preserve_mode",
          value: "smart",
        },
      },
      {
        name: "setRules",
        args: {
          projectPath: "E:/demo/project.lg",
          ruleType: "glossary",
          rules: [{ src: "勇者", dst: "Hero" }],
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "glossary_enable",
          value: true,
        },
      },
      {
        name: "setRuleText",
        args: {
          projectPath: "E:/demo/project.lg",
          ruleType: "translation_prompt",
          text: "翻译提示词",
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "translation_prompt_enable",
          value: true,
        },
      },
    ]);
    expect(result.loaded_names).toEqual(["术语表", "翻译提示词"]);
    expect(log_manager.info).toHaveBeenCalledWith("已自动加载默认预设：术语表 | 翻译提示词 …", {
      source: "project-lifecycle",
    });
  });

  it("单个默认预设读取失败时只记录诊断并继续返回可用初始化操作", () => {
    const app_root = create_temp_dir();
    const log_manager = create_log_manager();
    const initializer = create_initializer({
      app_root,
      log_manager,
      config: {
        glossary_default_preset: "builtin:missing.json",
      },
    });

    const result = initializer.build_operations("E:/demo/project.lg");

    expect(result.operations).toEqual([
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "text_preserve_mode",
          value: "smart",
        },
      },
    ]);
    expect(result.loaded_names).toEqual([]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      "默认质量规则预设加载失败 …",
      expect.objectContaining({
        context: { preset_directory: "glossary", virtual_id: "builtin:missing.json" },
        source: "project-lifecycle",
      }),
    );
  });

  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-default-preset-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  function write_file(file_path: string, content: string): string {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, "utf-8");
    return file_path;
  }

  function create_initializer(options: {
    app_root: string;
    config: MutableJsonRecord;
    log_manager: LogManager;
  }): ProjectDefaultPresetInitializer {
    return new ProjectDefaultPresetInitializer(
      create_setting_service(options.config),
      new AppPathService({ appRoot: options.app_root }),
      options.log_manager,
      default_native_fs,
    );
  }

  function create_setting_service(config: MutableJsonRecord): AppSettingService {
    return {
      read_setting: vi.fn(() => config),
    } as unknown as AppSettingService;
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
