import { log_batch_task_start, log_batch_request_failure } from "../batch-task/batch-task-log";
import { build_batch_request_result_log } from "./batch-request-log";
import { create_text_resolver } from "../../shared/i18n";
import { resolve_app_locale } from "../../domain/app-language";
import type { LogManager } from "../log/log-manager";
import { AppError } from "../../shared/error";
import path from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { is_json_record, type JsonRecord } from "../../domain/json";
import {
  empty_batch_task_progress,
  type BatchTaskProgress,
  type BatchTaskResult,
} from "../../domain/batch-task";
import { default_native_fs as fs } from "../../native/native-fs";
import type { RuntimeLease } from "../runtime-operation-gate";
import type { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import {
  LLM_REQUEST_MAX_BYTES,
  read_model_request_snapshot,
  read_request_timeout_ms,
} from "../llm/llm-request";
import type {
  LLMClientPort,
  LLMMessage,
  LLMRequestFacts,
  LLMRequestResult,
} from "../llm/llm-types";
import { BatchTaskRuntime, BatchTaskCompletionError } from "../batch-task/batch-task-runtime";
import { RequestRatePool, resolve_request_limits } from "../batch-task/request-rate";
import { RequestScheduler } from "../batch-task/request-scheduler";

const BATCH_REQUEST_LOG_SOURCE = "batch-request";

const BATCH_REQUEST_MANIFEST_SCHEMA = Type.Object(
  {
    format: Type.Literal("messages"),
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
const BASE64_PATTERN = "^[A-Za-z0-9+/]+={0,2}$";
/** 三类媒体共享字节契约，MIME 前缀与内容类型一致。 */
function media_content_schema(type: "image" | "audio" | "video") {
  return Type.Object(
    {
      type: Type.Literal(type),
      mime_type: Type.String({ pattern: `^${type}/[A-Za-z0-9.+-]+$` }),
      data: Type.String({ minLength: 4, pattern: BASE64_PATTERN }),
    },
    { additionalProperties: false },
  );
}
const CONTENT_SCHEMA = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String() }, { additionalProperties: false }),
  media_content_schema("image"),
  media_content_schema("audio"),
  media_content_schema("video"),
]);
const LLM_MESSAGES_SCHEMA = Type.Array(
  Type.Union([
    Type.Object(
      { role: Type.Literal("system"), content: Type.String() },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        role: Type.Literal("user"),
        content: Type.Union([Type.String(), Type.Array(CONTENT_SCHEMA, { minItems: 1 })]),
      },
      { additionalProperties: false },
    ),
  ]),
  { minItems: 1 },
);

const MESSAGES_SCHEMA = Type.Object(
  {
    messages: LLM_MESSAGES_SCHEMA,
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
/** 调用入口独立拥有的模型与应用设置快照，同批派发和重试保持一致。 */
export type BatchRequestConfig = { model: JsonRecord; config_snapshot: JsonRecord };
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
    if (!stat.isFile() || stat.size > LLM_REQUEST_MAX_BYTES)
      throw new Error("Input must be a JSON file no larger than 64 MB.");
    const body = await handle.readFile();
    if (body.byteLength > LLM_REQUEST_MAX_BYTES) throw new Error("Input exceeds 64 MB.");
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
  /** 注入唯一运行态、速率池与统一请求入口。 */
  public constructor(
    private readonly tasks: BatchTaskRuntime,
    private readonly rates: RequestRatePool,
    private readonly client: LLMClientPort,
    private readonly auth: Pick<ChatGPTAuthService, "bind">,
    private readonly log: Pick<LogManager, "append">,
  ) {}
  /** 固定配置并校验清单，再有界派发请求和发布结果。 */
  public async run(
    lease: RuntimeLease,
    signal: AbortSignal,
    root: string,
    execution: BatchRequestConfig,
    request_file: string,
  ): Promise<BatchRequestSummary> {
    signal.throwIfAborted();
    const { model, config_snapshot: settings } = execution;
    const t = create_text_resolver(resolve_app_locale(settings["app_language"]));
    const model_config_id = String(model["id"] ?? "");
    const config = read_model_request_snapshot(model, { user_agent: "" });
    const secrets = [...config.api_keys, ...Object.values(config.headers)].filter(Boolean);
    /** 在发布前清除响应和错误中回显的凭据。 */
    const redact = (_key: string, value: unknown): unknown =>
      typeof value === "string"
        ? secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value)
        : value;
    const manifest_path = path.resolve(root, request_file);
    const raw = await read_batch_request_json(manifest_path);
    if (!Check(BATCH_REQUEST_MANIFEST_SCHEMA, raw))
      throw new Error(
        "Invalid request manifest. Expected format and nonempty requests with id/input_file.",
      );
    const manifest = raw;
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
          log_batch_task_start(this.log, BATCH_REQUEST_LOG_SOURCE, model, t);
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
              const received = await this.client.request(
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
              // 在发布和日志前脱敏所有字符串，JSON replacer 不会破坏转义或响应结构。
              const result = JSON.parse(JSON.stringify(received, redact)) as LLMRequestResult;
              // 确定性的请求错误结束重试。认证失败交给批次收尾，其余拒绝只失败当前项。
              const rejected =
                result.http_status !== undefined &&
                result.http_status >= 400 &&
                result.http_status < 500 &&
                ![408, 429].includes(result.http_status);
              const account_failure = result.http_status === 401 || result.http_status === 403;
              return {
                ...result,
                response: {
                  format: "messages",
                  text: result.response_result,
                  thinking: result.response_think,
                },
                usage_complete: result.usage_complete ?? false,
                item_failure:
                  result.response_error !== undefined ||
                  result.request_error?.context?.["code"] === "request.validation_failed" ||
                  (rejected && !account_failure),
                ...(rejected ? { retryable: false } : {}),
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
            on_failure: (key_index, error) =>
              log_batch_request_failure(this.log, BATCH_REQUEST_LOG_SOURCE, key_index, error, t),
          });
          /** 单项正文错误单独结算，文件发布错误交给整批收尾。 */
          const run_one = async (index: number) => {
            const entry = manifest.requests[index]!;
            const started_at = Date.now();
            let result: RequestResult | undefined;
            let error: string | null = null;
            let payload: JsonRecord | undefined;
            let input_error: unknown;
            /** 每项只记录一次结果，完整响应保存在成果文件中。 */
            const log_result = (failure: string | null, cause?: unknown) =>
              this.log.append({
                source: BATCH_REQUEST_LOG_SOURCE,
                level: failure === null ? "info" : "error",
                content: build_batch_request_result_log({
                  run_id: handle.run_id,
                  request_id: entry.id,
                  started_at,
                  payload,
                  result,
                  error: failure,
                  t,
                }),
                ...(cause === undefined ? {} : { error: cause }),
              });
            const relative = `results/${String(index + 1).padStart(6, "0")}.json`;
            let status: "succeeded" | "failed";
            try {
              try {
                const raw_input = await read_batch_request_json(entry.input_file);
                if (
                  !is_json_record(raw_input) ||
                  !Check(MESSAGES_SCHEMA, raw_input) ||
                  raw_input.messages.some(
                    (message) =>
                      Array.isArray(message.content) &&
                      message.content.some(
                        (part) => part.type !== "text" && part.data.length % 4 !== 0,
                      ),
                  )
                )
                  throw new Error("Invalid request input.");
                payload = raw_input;
              } catch (failure) {
                input_error = failure;
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
              status = error === null ? "succeeded" : "failed";
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
                response: result?.response ?? null,
              });
            } catch (cause) {
              if (
                !(
                  active_signal.aborted &&
                  cause instanceof AppError &&
                  cause.code === "runtime.cancelled"
                )
              ) {
                const message = cause instanceof Error ? cause.message : String(cause);
                log_result(message, cause);
              }
              throw cause;
            }
            // 成果发布后才结算。后续事件失败由批次完成链报告。
            indexes[index] = { id: entry.id, status, result_file: relative };
            progress = {
              ...progress,
              succeeded: progress.succeeded + Number(status === "succeeded"),
              failed: progress.failed + Number(status === "failed"),
              time: Date.now() / 1000 - progress.start_time,
            };
            log_result(error, result?.request_error ?? result?.response_error ?? input_error);
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
      const result = await handle.completion;
      return summary(result);
    } catch (error) {
      if (error instanceof BatchTaskCompletionError) {
        this.log.append({
          source: BATCH_REQUEST_LOG_SOURCE,
          level: "error",
          content: t("app.log.request_failed", {
            ERROR: error.cause instanceof Error ? error.cause.message : String(error.cause),
          }),
          error: error.cause,
        });
        throw new BatchRequestCompletionError(summary(error.result), error.cause);
      }
      throw error;
    } finally {
      this.log.append({
        source: BATCH_REQUEST_LOG_SOURCE,
        level: "info",
        content: t("app.log.batch_request_ended"),
      });
    }
  }
}
