import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../utils/json-tool";

export interface ProjectStatePayload {
  // loaded 与 projectPath 必须来自 Python 会话权威，TS 写入口只消费快照。
  loaded: boolean;
  projectPath: string;
  // busy 由 Engine 持有，reset 类同步 mutation 用它避免和后台任务并发写入。
  busy: boolean;
}

// 任务快照结构由 Python tasks/snapshot 定义，TS bootstrap 只透传当前公开字段。
export type TaskSnapshotPayload = Record<string, ApiJsonValue>;

interface CoreBridgeClientOptions {
  // pyCoreBaseUrl 是 Electron main 内部地址，不能进入 preload 或 renderer。
  pyCoreBaseUrl: string;
  // pyCoreToken 只用于 TS Gateway 与 Python Core 之间的受控调用。
  pyCoreToken: string;
}

/**
 * 封装 TS Gateway 调用 Python Core 内部运行时桥的受控入口。
 */
export class CoreBridgeClient {
  // 内部 Core 地址只在 main 进程内保存，避免 renderer 依赖 Python 端口。
  private readonly py_core_base_url: string;

  // 所有受保护 Python 调用统一携带同一 token，避免各服务散落鉴权细节。
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
   * 读取 Python 任务快照，bootstrap 只借用任务权威，不回调 TS 公开 Gateway。
   */
  public async get_task_snapshot(): Promise<TaskSnapshotPayload> {
    const data = await this.post_py_core_json("/api/tasks/snapshot", {});
    const task = data["task"];
    return this.is_json_record(task) ? task : {};
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
   * 触发 Python Core 真实卸载工程，避免 TS 公开响应和 Python 会话状态分裂。
   */
  public async unload_project(): Promise<void> {
    await this.sync_runtime("project_unload", {});
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
   * 统一内部运行时桥 POST 细节，避免 token 和响应壳校验散落。
   */
  private async post_internal(
    path_name: string,
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    return this.post_py_core_json(path_name, body);
  }

  /**
   * TS Gateway 到 Python Core 的受控 JSON 调用统一携带内部 token。
   */
  private async post_py_core_json(
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
    throw new Error(envelope.error?.message ?? "Python Core JSON 调用失败。");
  }

  /**
   * 内部 JSON 响应只允许普通对象继续向业务层传播，避免数组或 null 被当作快照。
   */
  private is_json_record(value: ApiJsonValue | undefined): value is Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
