import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../utils/json-tool";

export interface ProjectStatePayload {
  loaded: boolean;
  projectPath: string;
  busy: boolean;
}

interface CoreBridgeClientOptions {
  pyCoreBaseUrl: string;
  pyCoreToken: string;
}

/**
 * 封装 TS Gateway 调用 Python Core 内部运行时桥的受控入口。
 */
export class CoreBridgeClient {
  private readonly py_core_base_url: string;
  private readonly py_core_token: string;

  /**
   * 初始化 CoreBridgeClient 依赖，保持外部写入口清晰。
   */
  public constructor(options: CoreBridgeClientOptions) {
    this.py_core_base_url = options.pyCoreBaseUrl;
    this.py_core_token = options.pyCoreToken;
  }

  /**
   * 读取 Python Core 当前工程运行态，供 TS 写入口构建 revision 回执。
   */
  public async get_project_state(): Promise<ProjectStatePayload> {
    const data = await this.post_internal("/internal/runtime/project-state", {});
    const loaded = typeof data["loaded"] === "boolean" ? data["loaded"] : false;
    const project_path = typeof data["projectPath"] === "string" ? data["projectPath"] : "";
    const busy = typeof data["busy"] === "boolean" ? data["busy"] : false;
    return { loaded, projectPath: project_path, busy };
  }

  /**
   * 申请 Python Core 侧文件操作锁，保持工作台 mutation 与任务执行互斥。
   */
  public async begin_project_file_operation(): Promise<void> {
    await this.sync_runtime("project_file_operation_begin", {});
  }

  /**
   * 释放 Python Core 侧文件操作锁，确保异常路径不会长期占用锁。
   */
  public async finish_project_file_operation(): Promise<void> {
    await this.sync_runtime("project_file_operation_end", {});
  }

  /**
   * 通知 Python Core 刷新内部缓存，保持 TS 写入后的运行时一致。
   */
  public async sync_runtime(
    change_type: string,
    payload: Record<string, ApiJsonValue>,
  ): Promise<void> {
    await this.post_internal("/internal/runtime/sync", {
      type: change_type,
      payload,
    });
  }

  /**
   * 统一内部桥 POST 细节，避免 token 和响应壳校验散落。
   */
  private async post_internal(
    path_name: string,
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const response = await fetch(`${this.py_core_base_url}${path_name}`, {
      body: JsonTool.stringifyStrict(body),
      headers: {
        "Content-Type": "application/json",
        "X-LinguaGacha-Core-Token": this.py_core_token,
      },
      method: "POST",
    });
    const envelope = (await response.json()) as {
      ok?: boolean;
      data?: Record<string, ApiJsonValue>;
      error?: { message?: string };
    };
    if (response.ok && envelope.ok === true) {
      return envelope.data ?? {};
    }
    throw new Error(envelope.error?.message ?? "Python Core 内部同步失败。");
  }
}
