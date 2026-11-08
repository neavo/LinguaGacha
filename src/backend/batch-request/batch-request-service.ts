import { AppError } from "../../shared/error";
import path from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { Model } from "../../domain/model";
import { is_json_record, type JsonRecord } from "../../domain/json";
import {
  empty_batch_task_progress,
  type BatchTaskProgress,
  type BatchTaskResult,
} from "../../domain/batch-task";
import { default_native_fs as fs } from "../../native/native-fs";
import type { RuntimeLease } from "../runtime-operation-gate";
import type { AppSettingService } from "../app/app-setting-service";
import type { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import { read_config_model_records } from "../model/model-config-resolver";
import { read_model_request_snapshot, read_request_timeout_ms } from "../llm/llm-request";
import type { LLMClientPort, LLMMessage, LLMRequestFacts } from "../llm/llm-types";
import { NATIVE_REQUEST_MAX_BYTES, NativeResponsesClient } from "../llm/native-responses";
import { BatchTaskRuntime, BatchTaskCompletionError } from "../batch-task/batch-task-runtime";
import { RequestRatePool, resolve_request_limits } from "../batch-task/request-rate";
import { RequestScheduler } from "../batch-task/request-scheduler";

const BATCH_REQUEST_MANIFEST_SCHEMA = Type.Object(
  {
    format: Type.Union([Type.Literal("messages"), Type.Literal("responses")]),
    requests: Type.Array(
      Type.Object(
        { id: Type.String({ minLength: 1 }), input_file: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
const MESSAGES_SCHEMA = Type.Object(
  {
    messages: Type.Array(
      Type.Object(
        {
          role: Type.Union([Type.Literal("system"), Type.Literal("user")]),
          content: Type.String(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
type RequestResult = LLMRequestFacts & {
  response: JsonRecord | null;
  usage_complete: boolean;
  item_failure: boolean;
};
type ResultIndex = {
  id: string;
  status: "succeeded" | "failed" | "unfinished";
  result_file: string | null;
};
export type BatchRequestSummary = {
  run_id: string;
  status: BatchTaskResult["status"];
  stop_source?: Exclude<BatchTaskResult["stop_source"], undefined>;
  total: number;
  succeeded: number;
  failed: number;
  unfinished: number;
  usage: BatchTaskProgress | null;
  result_file: string;
};
/** 工具错误同时携带可恢复的结果位置和已结算统计。 */
export class BatchRequestCompletionError extends Error {
  /** 保留批次摘要和导致失败的原始异常。 */
  public constructor(
    public readonly summary: BatchRequestSummary,
    cause: unknown,
  ) {
    super("Batch requests failed.", { cause });
  }
}
/** 有界读取单项原文，重试复用已解析正文。 */
async function read_batch_request_json(file: string): Promise<unknown> {
  const handle = await fs.open_file(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > NATIVE_REQUEST_MAX_BYTES)
      throw new Error("Input must be a JSON file no larger than 64 MB.");
    const body = await handle.readFile();
    if (body.byteLength > NATIVE_REQUEST_MAX_BYTES) throw new Error("Input exceeds 64 MB.");
    return JSON.parse(body.toString("utf8"));
  } finally {
    await handle.close();
  }
}
/** 临时文件和最终文件处于同一目录，只在完整写入后发布。 */
async function publish_json(file: string, value: unknown): Promise<void> {
  const temporary = file + ".tmp";
  await fs.write_file(temporary, JSON.stringify(value, null, 2));
  fs.rename(temporary, file);
}
/** 通用请求只拥有工作区成果，批次生命周期和网络恢复均使用共享服务。 */
export class BatchRequestService {
  /** 注入唯一运行态、速率池与两个传输入口。 */
  public constructor(
    private readonly tasks: BatchTaskRuntime,
    private readonly rates: RequestRatePool,
    private readonly settings: Pick<AppSettingService, "read_setting">,
    private readonly client: LLMClientPort,
    private readonly native: NativeResponsesClient,
    private readonly auth: Pick<ChatGPTAuthService, "bind">,
  ) {}
  /** 固定配置并校验清单，再有界派发请求和发布结果。 */
  public async run(
    lease: RuntimeLease,
    signal: AbortSignal,
    root: string,
    model_config_id: string,
    request_file: string,
  ): Promise<BatchRequestSummary> {
    signal.throwIfAborted();
    const settings = structuredClone(this.settings.read_setting());
    const record = read_config_model_records(settings).find(
      (entry) => entry["id"] === model_config_id,
    );
    if (!record) throw new Error(`Model configuration not found: ${model_config_id}`);
    const model = Model.from_json(record, model_config_id).to_json();
    const config = read_model_request_snapshot(model, { user_agent: "" });
    const manifest_path = path.resolve(root, request_file);
    const raw = await read_batch_request_json(manifest_path);
    if (!Check(BATCH_REQUEST_MANIFEST_SCHEMA, raw))
      throw new Error(
        "Invalid request manifest. Expected format and nonempty requests with id/input_file.",
      );
    const manifest = raw;
    if (
      manifest.format === "responses" &&
      (config.api_format !== "OpenAIResponses" || config.auth_type !== "api_key")
    )
      throw new Error(
        "responses requires API Key OpenAIResponses; messages supports the saved text protocols and OAuth.",
      );
    const ids = new Set<string>();
    for (const entry of manifest.requests) {
      if (!entry.id.trim() || ids.has(entry.id))
        throw new Error(`Duplicate or empty request id: ${entry.id}`);
      ids.add(entry.id);
      entry.input_file = path.resolve(path.dirname(manifest_path), entry.input_file);
      const handle = await fs.open_file(entry.input_file, "r");
      try {
        if (!(await handle.stat()).isFile())
          throw new Error(`Input is not a regular file: ${entry.input_file}`);
      } finally {
        await handle.close();
      }
    }
    signal.throwIfAborted();
    const handle = this.tasks.begin_under_agent(lease, signal, "request");
    const directory = path.join(root, "work", "batch-requests", handle.run_id);
    const result_file = path.join(directory, "result.json");
    const indexes: ResultIndex[] = manifest.requests.map((entry) => ({
      id: entry.id,
      status: "unfinished",
      result_file: null,
    }));
    let progress = empty_batch_task_progress("request", indexes.length);
    const summary = (result: BatchTaskResult): BatchRequestSummary => ({
      run_id: handle.run_id,
      status: result.status,
      ...(result.stop_source === undefined ? {} : { stop_source: result.stop_source }),
      total: progress.total,
      succeeded: progress.succeeded,
      failed: progress.failed,
      unfinished: progress.total - progress.succeeded - progress.failed,
      usage: result.progress,
      result_file,
    });
    let directory_ready = false; // 目录建立后才尝试发布最终索引。
    try {
      await this.tasks.execute(
        handle,
        async () => {
          await fs.make_dir_async(path.dirname(directory));
          await fs.make_dir_exclusive(directory);
          await fs.make_dir_async(path.join(directory, "results"));
          directory_ready = true;
          const limits = resolve_request_limits(model);
          const config_summary = {
            model_config_id,
            model_name: String(model["name"] ?? ""),
            model_id: config.model_id,
            thinking_level: config.thinking_level,
            concurrency_limit: limits.concurrency_limit,
            rpm_limit: limits.rpm_limit,
          };
          await publish_json(path.join(directory, "manifest.json"), {
            ...manifest,
            config: config_summary,
          });
          await this.tasks.publish_config(handle, config_summary);
          await this.tasks.publish_progress(handle, progress);
          await this.tasks.publish_status(handle, "running");
          const controller = new AbortController(); // 基础设施故障取消同批请求，不改写用户的停止来源。
          const active_signal = AbortSignal.any([handle.signal, controller.signal]);
          const auth_session = config.auth_type === "oauth" ? this.auth.bind() : undefined;
          const scheduler = new RequestScheduler<
            { id: string; payload: JsonRecord },
            RequestResult
          >({
            model,
            rate: this.rates.resolve(model),
            timeout_ms: read_request_timeout_ms(settings),
            dispatch: async ({ id, payload }, key, request_signal) => {
              if (manifest.format === "responses")
                return this.native.request(
                  {
                    payload,
                    model: { ...model, api_key: key },
                    config_snapshot: settings,
                    run_id: handle.run_id,
                  },
                  request_signal,
                );
              const result = await this.client.request(
                {
                  run_id: handle.run_id,
                  work_unit_id: id,
                  model: { ...model, api_key: key },
                  config_snapshot: settings,
                  messages: payload["messages"] as unknown as LLMMessage[],
                  ...(auth_session === undefined ? {} : { auth_session }),
                },
                request_signal,
              );
              return {
                ...result,
                response: {
                  format: "messages",
                  text: result.response_result,
                  thinking: result.response_think,
                },
                usage_complete: result.usage_complete ?? false,
                item_failure: result.response_error !== undefined,
              };
            },
            fail_batch: (result) => !result.item_failure,
            on_attempt: (result) => {
              progress = {
                ...progress,
                input_tokens: progress.input_tokens + result.input_tokens,
                reasoning_tokens: progress.reasoning_tokens + result.reasoning_tokens,
                output_tokens: progress.output_tokens + result.output_tokens,
                usage_complete: progress.usage_complete && result.usage_complete,
              };
            },
            on_state: (state) => this.tasks.update_request_state(handle, state),
            on_failure: () => {}, // 恢复状态由进度面板展示，避免每次重试重复追加错误。
          });
          /** 单项正文错误单独结算，文件发布错误交给整批收尾。 */
          const run_one = async (index: number) => {
            const entry = manifest.requests[index]!;
            let result: RequestResult | undefined;
            let error: string | null = null;
            let payload: JsonRecord | undefined;
            try {
              const raw_input = await read_batch_request_json(entry.input_file);
              if (
                !is_json_record(raw_input) ||
                (manifest.format === "messages" && !Check(MESSAGES_SCHEMA, raw_input))
              )
                throw new Error("Invalid request input.");
              payload = raw_input;
            } catch (failure) {
              error = failure instanceof Error ? failure.message : "Input could not be read.";
            }
            if (active_signal.aborted) return;
            if (payload !== undefined) {
              result = await scheduler.request({ id: entry.id, payload }, active_signal);
              if (result.cancelled || active_signal.aborted) return;
              error =
                result.request_error?.message ??
                result.response_error?.message ??
                (result.item_failure ? "Request failed." : null);
            }
            const status = error === null ? "succeeded" : "failed";
            const relative = `results/${String(index + 1).padStart(6, "0")}.json`;
            await publish_json(path.join(directory, relative), {
              id: entry.id,
              status,
              usage:
                result === undefined
                  ? null
                  : {
                      input_tokens: result.input_tokens,
                      reasoning_tokens: result.reasoning_tokens,
                      output_tokens: result.output_tokens,
                      complete: result.usage_complete,
                    },
              error,
              response:
                manifest.format === "responses"
                  ? { format: "responses", raw: result?.response ?? null }
                  : (result?.response ?? null),
            });
            indexes[index] = { id: entry.id, status, result_file: relative };
            progress = {
              ...progress,
              succeeded: progress.succeeded + Number(status === "succeeded"),
              failed: progress.failed + Number(status === "failed"),
              time: Date.now() / 1000 - progress.start_time,
            };
            await this.tasks.publish_progress(handle, progress);
          };
          const pending = new Set<Promise<void>>(); // 成功请求释放额度，失败请求保留到统一收尾。
          let next = 0;
          try {
            while ((next < indexes.length || pending.size > 0) && !active_signal.aborted) {
              while (
                next < indexes.length &&
                pending.size < scheduler.read_concurrency_limit() &&
                !active_signal.aborted
              ) {
                const work = run_one(next++);
                pending.add(work);
                void work.then(
                  () => pending.delete(work),
                  () => {},
                );
              }
              if (pending.size > 0) await Promise.race(pending);
            }
          } catch {
            controller.abort(); // 失败请求保留在 pending 中，统一等待后读取原始异常。
          }
          const settled = await Promise.allSettled(pending);
          const errors = new Set(
            settled.flatMap((result) => {
              if (result.status !== "rejected") return [];
              const error: unknown = result.reason;
              // 停止只忽略调度器的取消回执，文件发布和事件错误仍须报告。
              return active_signal.aborted &&
                error instanceof AppError &&
                error.code === "runtime.cancelled"
                ? []
                : [error];
            }),
          );
          try {
            await this.tasks.publish_progress(handle, progress);
          } catch (error) {
            errors.add(error);
          }
          if (errors.size > 0) {
            const causes = [...errors];
            throw causes.length === 1
              ? causes[0]
              : new AggregateError(causes, "Batch requests failed.", { cause: causes[0] });
          }
          return handle.signal.aborted ? "stopped" : "done";
        },
        async (result) => {
          if (directory_ready)
            await publish_json(result_file, { ...summary(result), requests: indexes });
        },
      );
      return summary(await handle.completion);
    } catch (error) {
      if (error instanceof BatchTaskCompletionError)
        throw new BatchRequestCompletionError(summary(error.result), error.cause);
      throw error;
    }
  }
}

/** 发现投影只发布可选择身份，绝不复制认证、地址或扩展请求配置。 */
export function project_model_configs(settings: JsonRecord): JsonRecord[] {
  return read_config_model_records(settings).map((entry) => {
    const model = Model.from_json(entry, String(entry["id"] ?? ""));
    return {
      model_config_id: model.id,
      name: model.name,
      model_id: model.model_id,
      api_format: model.api_format,
      auth_type: model.auth_type,
      formats:
        model.api_format === "OpenAIResponses" && model.auth_type !== "oauth"
          ? ["messages", "responses"]
          : ["messages"],
    };
  });
}
