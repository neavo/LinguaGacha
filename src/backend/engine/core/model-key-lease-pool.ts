import type { JsonRecord } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { LLMClientPolicy } from "../../llm/llm-client-policy";

/**
 * ModelKeyLeasePool 在 TaskEngine 进程内按模型资源签名做全局 round-robin，不让 worker 本地轮换分裂 Key 分布。
 */
export class ModelKeyLeasePool {
  private readonly offsets = new Map<string, number>(); // 只记录下一次 key 下标，不保存任何任务状态

  /**
   * work unit 即将真实进入 in-flight 前调用；返回写入单个租约 key 的模型快照副本。
   */
  public lease_model(model: JsonRecord): JsonRecord {
    const keys = LLMClientPolicy.collect_api_keys(String(model["api_key"] ?? ""));
    const signature = this.build_signature(model, keys);
    const offset = this.offsets.get(signature) ?? 0;
    const selected_key = keys[offset % keys.length] ?? "no_key_required";
    this.offsets.set(signature, offset + 1);
    return { ...model, api_key: selected_key };
  }

  /**
   * 签名包含规范化 key 列表，保证同一模型资源池共享一个轮换游标。
   */
  private build_signature(model: JsonRecord, keys: string[]): string {
    return JsonTool.stringifyStrict({
      api_format: String(model["api_format"] ?? "OpenAI"),
      api_url: String(model["api_url"] ?? ""),
      model_id: String(model["model_id"] ?? ""),
      keys,
    });
  }
}
