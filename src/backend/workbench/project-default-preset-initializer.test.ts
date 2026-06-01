import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettingService } from "../app/app-setting-service";
import { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";
import { default_native_fs } from "../../native/native-fs";
import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectDefaultPresetInitializer } from "../workbench/project-default-preset-initializer";

// 测试只需要设置服务可返回的 JSON 片段，避免引入完整 AppSettingService 结构。
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
    write_file(
      path.join(app_root, "resource", "analysis_prompt", "preset", "base.txt"),
      "\uFEFF分析提示词\n",
    );
    const log_manager = create_log_manager();
    const initializer = create_initializer({
      app_root,
      log_manager,
      config: {
        glossary_default_preset: "builtin:base.json",
        translation_custom_prompt_default_preset: "builtin:base.txt",
        analysis_custom_prompt_default_preset: "builtin:base.txt",
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
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "quality_rule_revision.glossary",
          value: 1,
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
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "quality_prompt_revision.translation",
          value: 1,
        },
      },
      {
        name: "setRuleText",
        args: {
          projectPath: "E:/demo/project.lg",
          ruleType: "analysis_prompt",
          text: "分析提示词",
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "analysis_prompt_enable",
          value: true,
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "quality_prompt_revision.analysis",
          value: 1,
        },
      },
    ]);
    expect(result.loaded_names).toEqual(["术语表", "翻译提示词", "分析提示词"]);
    expect(log_manager.info).toHaveBeenCalledWith(
      "已自动加载默认预设：术语表 | 翻译提示词 | 分析提示词 …",
      {
        source: "project-lifecycle",
      },
    );
  });

  it("文本保护和替换默认预设成功加载时写入模式、物理类型和 revision", () => {
    const app_root = create_temp_dir();
    write_file(
      path.join(app_root, "resource", "text_preserve", "preset", "base.json"),
      JsonTool.stringifyStrict([{ src: "\\[[^\\]]+\\]" }]),
    );
    write_file(
      path.join(app_root, "resource", "pre_translation_replacement", "preset", "base.json"),
      JsonTool.stringifyStrict([{ src: "Ａ", dst: "A" }]),
    );
    write_file(
      path.join(app_root, "resource", "post_translation_replacement", "preset", "base.json"),
      JsonTool.stringifyStrict([{ src: "END", dst: "完" }]),
    );
    const initializer = create_initializer({
      app_root,
      log_manager: create_log_manager(),
      config: {
        text_preserve_default_preset: "builtin:base.json",
        pre_translation_replacement_default_preset: "builtin:base.json",
        post_translation_replacement_default_preset: "builtin:base.json",
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
      {
        name: "setRules",
        args: {
          projectPath: "E:/demo/project.lg",
          ruleType: "text_preserve",
          rules: [{ src: "\\[[^\\]]+\\]" }],
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "text_preserve_mode",
          value: "custom",
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "quality_rule_revision.text_preserve",
          value: 1,
        },
      },
      {
        name: "setRules",
        args: {
          projectPath: "E:/demo/project.lg",
          ruleType: "pre_translation_replacement",
          rules: [{ src: "Ａ", dst: "A" }],
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "pre_translation_replacement_enable",
          value: true,
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "quality_rule_revision.pre_replacement",
          value: 1,
        },
      },
      {
        name: "setRules",
        args: {
          projectPath: "E:/demo/project.lg",
          ruleType: "post_translation_replacement",
          rules: [{ src: "END", dst: "完" }],
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "post_translation_replacement_enable",
          value: true,
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "E:/demo/project.lg",
          key: "quality_rule_revision.post_replacement",
          value: 1,
        },
      },
    ]);
    expect(result.loaded_names).toEqual(["文本保护", "译前替换", "译后替换"]);
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
    expect(result.operations).not.toContainEqual(
      expect.objectContaining({
        name: "setMeta",
        args: expect.objectContaining({ key: "quality_rule_revision.glossary" }),
      }),
    );
    expect(result.loaded_names).toEqual([]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      "默认质量规则预设加载失败 …",
      expect.objectContaining({
        context: expect.objectContaining({
          preset_directory: "glossary",
          virtual_id: "builtin:missing.json",
        }),
        error: expect.objectContaining({
          message: expect.stringContaining("missing.json"),
        }),
        source: "project-lifecycle",
      }),
    );
  });

  // 创建独立临时 app_root，让内置预设路径走真实 AppPathService 规则。
  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-default-preset-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  // 预设文件必须落到真实目录，才能覆盖 NativeFs 与路径解析的组合行为。
  function write_file(file_path: string, content: string): string {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, "utf-8");
    return file_path;
  }

  // 初始化器测试保留真实路径服务和 NativeFs，只替换设置与日志边界。
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

  // 设置服务 fake 只暴露本测试关心的默认预设配置。
  function create_setting_service(config: MutableJsonRecord): AppSettingService {
    return {
      read_setting: vi.fn(() => config),
    } as unknown as AppSettingService;
  }

  // 日志 fake 用于断言非阻断诊断和成功加载摘要。
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
