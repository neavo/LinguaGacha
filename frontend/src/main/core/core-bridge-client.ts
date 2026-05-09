import type { ApiJsonValue } from "../api/api-types";
import type { TaskEngineStatePayload } from "../task/task-types";
import { JsonTool } from "../../utils/json-tool";

/**
 * Python Core 内部项目运行态，只供 TS 侧互斥与同步判断使用。
 */
export interface ProjectStatePayload {
  // loaded/projectPath 仅用于内部一致性兼容；公开状态由 TS ProjectSessionState 持有。
  loaded: boolean;
  projectPath: string;
  // busy 由 Engine 持有，reset 类同步 mutation 用它避免和后台任务并发写入。
  busy: boolean;
}

/**
 * CoreBridgeClient 只接收内部 Core 地址和 token，不暴露到 preload/renderer。
 */
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
   * 读取 Python Core 内部运行态，当前主要用于 busy / 文件互斥等任务守卫。
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
   * 触发 Python Core 加载工程，只用于未迁移 Engine 的读侧缓存同步。
   */
  public async load_project(project_path: string): Promise<void> {
    await this.sync_runtime("project_load", { project_path });
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
   * 读取内部 Engine 任务状态；公开进度快照由 TS task builder 自己组装。
   */
  public async get_task_engine_state(): Promise<TaskEngineStatePayload> {
    const data = await this.post_internal("/internal/runtime/tasks/state", {});
    return {
      status: typeof data["status"] === "string" ? data["status"] : "IDLE",
      busy: typeof data["busy"] === "boolean" ? data["busy"] : false,
      request_in_flight_count: this.read_number(data["request_in_flight_count"], 0),
      active_task_type:
        typeof data["active_task_type"] === "string" ? data["active_task_type"] : "idle",
      retranslating_item_ids: this.normalize_number_list(data["retranslating_item_ids"]),
    };
  }

  /**
   * 通过内部桥启动翻译任务，Python 只接收 Engine 命令。
   */
  public async start_translation(body: Record<string, ApiJsonValue>): Promise<void> {
    await this.post_internal("/internal/runtime/tasks/start-translation", body);
  }

  /**
   * 通过内部桥请求停止翻译任务。
   */
  public async stop_translation(): Promise<void> {
    await this.post_internal("/internal/runtime/tasks/stop-translation", {});
  }

  /**
   * 通过内部桥启动分析任务，公开回执留给 TS task service 生成。
   */
  public async start_analysis(body: Record<string, ApiJsonValue>): Promise<void> {
    await this.post_internal("/internal/runtime/tasks/start-analysis", body);
  }

  /**
   * 通过内部桥请求停止分析任务。
   */
  public async stop_analysis(): Promise<void> {
    await this.post_internal("/internal/runtime/tasks/stop-analysis", {});
  }

  /**
   * 通过内部桥启动批量重翻任务，item_ids 已在 TS 公开边界去重。
   */
  public async start_retranslate(body: Record<string, ApiJsonValue>): Promise<void> {
    await this.post_internal("/internal/runtime/tasks/start-retranslate", body);
  }

  /**
   * 单条翻译继续复用 Python Engine 低频同步入口。
   */
  public async translate_single(
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    return this.post_internal("/internal/runtime/tasks/translate-single", body);
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
   * 内部 Engine 数字坏值统一归零，避免公开 snapshot 出现 NaN。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 归一内部重翻 id 列表，保护 Python 桥返回旧值或重复值。
   */
  private normalize_number_list(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const ids: number[] = [];
    const seen_ids = new Set<number>();
    for (const item of value) {
      const item_id = this.read_number(item, NaN);
      if (!Number.isFinite(item_id) || item_id <= 0 || seen_ids.has(item_id)) {
        continue;
      }
      seen_ids.add(item_id);
      ids.push(item_id);
    }
    return ids;
  }
}
