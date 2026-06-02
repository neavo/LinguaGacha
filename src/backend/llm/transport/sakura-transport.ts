import { JsonTool } from "../../../shared/utils/json-tool";
import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { OpenAICompatibleTransport } from "./openai-compatible-transport";
import type { ProviderClientResolver } from "./transport-types";

/**
 * SakuraTransport 复用 openai SDK transport，但按 SakuraLLM 旧协议把逐行文本转成 JSON map。
 */
export class SakuraTransport extends OpenAICompatibleTransport {
  /**
   * SakuraLLM 与 OpenAI-compatible 共用 openai SDK client pool。
   */
  public constructor(pool: ProviderClientResolver) {
    super(pool);
  }

  /**
   * 发送请求后只转换成功响应，错误和取消载荷保持父类原样。
   */
  public override async send(
    policy: ResolvedRequestPolicy,
    signal: AbortSignal,
  ): Promise<LLMRequestResult> {
    const result = await super.send(policy, signal);
    if (result.response_result === "" || result.request_error !== undefined) {
      return result;
    }
    return { ...result, response_result: this.convert_sakura_response(result.response_result) };
  }

  /**
   * SakuraLLM 固定返回纯文本逐行响应，统一转成 ResponseDecoder 可消费的 JSON map。
   */
  private convert_sakura_response(response_result: string): string {
    const rows: Record<string, string> = {};
    for (const [index, line] of response_result.trim().split(/\r?\n/u).entries()) {
      rows[String(index)] = line.trim();
    }
    return JsonTool.stringifyStrict(rows);
  }
}
