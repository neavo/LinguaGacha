import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../utils/json-tool";

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
}
