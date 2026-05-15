import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app_error } from "../api/api-error";

export interface AppPathServiceOptions {
  appRoot: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

const HOME_DATA_ROOT_NAME = "LinguaGacha";
const RESOURCE_DIR_NAME = "resource";
const USER_DATA_DIR_NAME = "userdata";
const LOG_DIR_NAME = "log";
const TEMPLATE_DIR_NAME = "template";
const PRESET_DIR_NAME = "preset";

/**
 * API Gateway 统一持有运行时根规则，避免配置和预设写到两处
 */
export class AppPathService {
  private readonly app_root: string;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private data_root: string | null = null;

  /**
   * 初始化 AppPathService 依赖，保持外部写入口清晰
   */
  public constructor(options: AppPathServiceOptions) {
    this.app_root = path.resolve(options.appRoot);
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
  }

  /**
   * 返回应用根，供启动链路和资源解析共享同一事实
   */
  public get_app_root(): string {
    return this.app_root;
  }

  /**
   * 返回可写数据根，避免调用方自行猜测用户数据位置
   */
  public get_data_root(): string {
    if (this.data_root === null) {
      this.data_root = this.resolve_data_root();
    }
    return this.data_root;
  }

  /**
   * 解析资源绝对路径，保持发布态和开发态一致
   */
  public get_resource_path(...parts: string[]): string {
    return path.join(this.app_root, RESOURCE_DIR_NAME, ...parts);
  }

  /**
   * 解析资源相对路径，避免各服务重复拼接目录
   */
  public get_resource_relative_path(...parts: string[]): string {
    return path.join(RESOURCE_DIR_NAME, ...parts).replace(/\\/g, "/");
  }

  /**
   * 返回 userdata 根目录，收口配置和预设写入位置
   */
  public get_user_data_root_dir(): string {
    return path.join(this.get_data_root(), USER_DATA_DIR_NAME);
  }

  /**
   * 解析 userdata 下的文件路径，避免外部拼接跨平台路径
   */
  public get_user_data_path(...parts: string[]): string {
    return path.join(this.get_user_data_root_dir(), ...parts);
  }

  /**
   * 返回日志目录，保持诊断文件落点稳定
   */
  public get_log_dir(): string {
    return path.join(this.get_data_root(), LOG_DIR_NAME);
  }

  /**
   * 返回应用配置路径，维持 config.json 唯一事实源
   */
  public get_config_path(): string {
    return this.get_user_data_path("config.json");
  }

  /**
   * 返回内置模型预设目录，保持模型资源入口集中
   */
  public get_model_preset_dir(): string {
    return this.get_resource_path("model", PRESET_DIR_NAME);
  }

  /**
   * 返回内置质量规则预设目录，保持规则资源入口集中
   */
  public get_quality_rule_builtin_preset_dir(preset_directory: string): string {
    return this.get_resource_path(preset_directory, PRESET_DIR_NAME);
  }

  /**
   * 返回内置质量规则相对目录，用于组合预设虚拟 id
   */
  public get_quality_rule_builtin_preset_relative_dir(preset_directory: string): string {
    return this.get_resource_relative_path(preset_directory, PRESET_DIR_NAME);
  }

  /**
   * 返回用户质量规则预设目录，保持用户文件写入口集中
   */
  public get_quality_rule_user_preset_dir(preset_directory: string): string {
    return this.get_user_data_path(preset_directory);
  }

  /**
   * 将提示词任务类型映射为目录名，避免资源路径出现第二套命名
   */
  public get_prompt_task_dir_name(task_type: string): string {
    if (task_type !== "translation" && task_type !== "analysis") {
      throw app_error("internal_invariant", `未知提示词任务类型：${task_type}`);
    }
    return `${task_type}_prompt`;
  }

  /**
   * 返回提示词模板目录，保持模板读取路径集中
   */
  public get_prompt_template_dir(task_type: string, language: string): string {
    return this.get_resource_path(
      this.get_prompt_task_dir_name(task_type),
      TEMPLATE_DIR_NAME,
      language.toLowerCase(),
    );
  }

  /**
   * 返回内置提示词预设目录，保持提示词资源入口集中
   */
  public get_prompt_builtin_preset_dir(task_type: string): string {
    return this.get_resource_path(this.get_prompt_task_dir_name(task_type), PRESET_DIR_NAME);
  }

  /**
   * 返回内置提示词相对目录，用于生成稳定虚拟 id
   */
  public get_prompt_builtin_preset_relative_dir(task_type: string): string {
    return this.get_resource_relative_path(
      this.get_prompt_task_dir_name(task_type),
      PRESET_DIR_NAME,
    );
  }

  /**
   * 返回用户提示词预设目录，保持用户预设写入集中
   */
  public get_prompt_user_preset_dir(task_type: string): string {
    return this.get_user_data_path(this.get_prompt_task_dir_name(task_type));
  }

  /**
   * 读取纯数值版本号，保持健康检查展示来源唯一
   */
  public read_version(): string {
    const version_path = path.join(this.app_root, "version.txt");
    return fs.readFileSync(version_path, "utf-8").trim();
  }

  /**
   * 选择可写数据根，兼容打包态和只读应用目录
   */
  private resolve_data_root(): string {
    const home_data_root = path.join(os.homedir(), HOME_DATA_ROOT_NAME);
    if (this.env["APPIMAGE"] !== undefined) {
      return home_data_root;
    }
    if (this.platform === "darwin" && this.app_root.includes(".app/Contents/MacOS")) {
      return home_data_root;
    }
    if (this.can_write_directory(this.app_root)) {
      return this.app_root;
    }
    return home_data_root;
  }

  /**
   * 探测目录可写性，避免启动时误用只读应用根
   */
  private can_write_directory(directory: string): boolean {
    try {
      fs.mkdirSync(directory, { recursive: true });
      const probe_path = path.join(
        directory,
        `.linguagacha_write_probe_${Date.now().toString()}_${Math.random().toString(16).slice(2)}`,
      );
      fs.writeFileSync(probe_path, "");
      fs.rmSync(probe_path, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
