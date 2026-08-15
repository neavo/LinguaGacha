import type { LogError } from "../../../shared/error";
import type { LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";
import type { WorkUnit } from "../protocol/work-unit";

/** 父线程发往 work-unit worker 的完整命令集合。 */
export type WorkUnitWorkerCommand =
  | { type: "execute"; id: string; unit: WorkUnit } // id 关联最终 work-unit 结果
  | { type: "cancel"; id: string } // 只取消同 id 的执行
  | {
      type: "llm_result";
      requestId: string; // 关联 worker 发出的单次 llm_request
      result: { ok: true; data: LLMRequestResult } | { ok: false; error: LogError };
    };

/** work-unit worker 回传父线程的终态或中性 LLM 请求。 */
export type WorkUnitWorkerEvent =
  | {
      type: "result";
      id: string; // 对应 execute.id
      result: { ok: true; data: unknown } | { ok: false; error: LogError };
    }
  | { type: "llm_request"; requestId: string; body: LLMRequestBody }; // requestId 只在 worker 内唯一
