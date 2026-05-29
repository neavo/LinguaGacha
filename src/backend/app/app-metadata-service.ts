import { AppPathService } from "./app-path-service";
import { NativeFs, default_native_fs } from "../../native/native-fs";

const REPO_URL = "https://github.com/neavo/LinguaGacha";
const USER_AGENT_NAME = "LinguaGacha";
const DEFAULT_VERSION = "0.0.0";

/**
 * AppMetadataService 持有 version.txt 等应用元信息的只读缓存。
 */
export class AppMetadataService {
  private readonly paths: AppPathService; // paths 提供 version.txt 唯一路径
  private readonly native_fs: NativeFs; // native_fs 只负责读取应用元信息文件
  private cached_version: string | null = null; // cached_version 是严格版本读取缓存
  private cached_fallback_version: string | null = null; // cached_fallback_version 服务允许缺失版本的调用点

  /**
   * 初始化应用元信息读取依赖，保持版本文件语义独立于路径服务。
   */
  public constructor(paths: AppPathService, native_fs: NativeFs = default_native_fs) {
    this.paths = paths;
    this.native_fs = native_fs;
  }

  /**
   * 严格读取应用版本，供健康检查和生命周期日志暴露真实发布事实。
   */
  public read_version(): string {
    if (this.cached_version === null) {
      this.cached_version = this.native_fs.read_text_file(this.paths.get_version_path()).trim();
    }
    return this.cached_version;
  }

  /**
   * 读取可降级版本，LLM User-Agent 在测试或源码环境缺失版本文件时仍能发请求。
   */
  public read_version_or_default(): string {
    if (this.cached_fallback_version !== null) {
      return this.cached_fallback_version;
    }
    try {
      const version = this.read_version();
      this.cached_fallback_version = version === "" ? DEFAULT_VERSION : version;
    } catch {
      this.cached_fallback_version = DEFAULT_VERSION;
    }
    return this.cached_fallback_version;
  }

  /**
   * 生成 LinguaGacha 官方 User-Agent，供 LLM 请求诊断使用。
   */
  public build_linguagacha_user_agent(): string {
    return `${USER_AGENT_NAME}/v${this.read_version_or_default()} (${REPO_URL})`;
  }
}
