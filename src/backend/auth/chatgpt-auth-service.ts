import { randomUUID } from "node:crypto";
import type { ModelAuth } from "@earendil-works/pi-ai";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { AppError, to_api_error_payload } from "../../shared/error";
import {
  MODEL_AUTH_CHANGED_EVENT_TOPIC,
  type ChatGPTAuthSnapshot,
  type ChatGPTLoginSnapshot,
  type ChatGPTLoginResponse,
} from "../../shared/model-auth";
import type { JsonRecord } from "../../domain/json";
import type { AppPathService } from "../app/app-path-service";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { without_http_response_info } from "../network/http-response-info";
import { create_provider_error } from "../network/provider-error";
import { ChatGPTCredentialStore } from "./chatgpt-credential-store";
import {
  refresh_chatgpt_credential,
  start_chatgpt_login,
  revoke_chatgpt_session,
  type ChatGPTCredential,
} from "./chatgpt-oauth";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;
const REVOKE_TIMEOUT_MS = 15_000;
const REFRESH_AHEAD_MS = 5 * 60 * 1_000;
type LoginAttempt = {
  id: string; // 跨进程回调归属，与文件中的 login_id 对应。
  controller: AbortController; // 当前授权尝试的取消源。
  authorization: PromiseWithResolvers<string>; // 首次启动期间的重复点击等待同一授权地址。
  completion: Promise<void>; // 从监听启动覆盖到凭据落盘和资源清理。
};

/** 应用级账户拥有者；模型只引用当前连接，GUI 和 CLI 共用同一文件存储。 */
export class ChatGPTAuthService {
  private readonly store: ChatGPTCredentialStore; // 唯一持久化入口与跨进程刷新锁。
  private readonly lifetime = new AbortController(); // 服务关闭后拒绝新凭据请求。
  private readonly resolving = new Set<Promise<unknown>>(); // 关闭时等待已经开始的 token 轮换落盘。
  private readonly instance_id = randomUUID(); // `revision` 的后端实例归属。
  private revision = 0; // 拒绝 HTTP 与 SSE 的迟到快照。
  private pending: LoginAttempt | null = null; // 后端持有协议资源，页面通过授权 ID 请求取消。
  private login_snapshot: ChatGPTLoginSnapshot | null = null; // 最近一次结果供 HTTP 与 SSE 共同恢复。
  private logging_out = false; // 退出清理期间拒绝建立新的授权尝试。

  /** 装配单账户认证与存储，OAuth 失败保持显式错误语义。 */
  public constructor(
    paths: AppPathService,
    private readonly gate: RuntimeOperationGate,
    private readonly publish: (topic: string, payload: JsonRecord) => void,
  ) {
    this.store = new ChatGPTCredentialStore(paths.get_user_data_path("auth", "chatgpt.json"));
  }

  /** 账户两态与授权操作分开表达，公开快照不携带 token 或授权 URL。 */
  public snapshot(): ChatGPTAuthSnapshot {
    const account = this.store.read_account();
    return {
      instance_id: this.instance_id,
      revision: this.revision,
      connected: account.credential !== null,
      login: this.login_snapshot === null ? null : structuredClone(this.login_snapshot),
    };
  }

  /** 在任务启动时固定会话，不把 token 放进模型配置或 worker 消息。 */
  public bind(): string {
    const credential = this.store.read_account().credential;
    if (credential === null) {
      this.emit();
      throw new AppError("model.auth_required");
    }
    return credential.session_id;
  }

  /** 每次真实请求解析 token；单个调用者取消不撤销共享刷新和轮换凭据保存。 */
  public async resolve(session_id: string, signal?: AbortSignal): Promise<ModelAuth> {
    signal?.throwIfAborted();
    const operation = without_http_response_info(() => this.resolve_credential(session_id)).finally(
      () => {
        this.resolving.delete(operation);
      },
    );
    this.resolving.add(operation);
    try {
      const result =
        signal === undefined ? await operation : await raceWithAbortSignal(operation, signal);
      // 解析可能跨过另一进程的账户替换，返回前复核本轮身份。
      this.read_session(session_id);
      signal?.throwIfAborted();
      return { apiKey: result.access };
    } catch (cause) {
      signal?.throwIfAborted();
      const error = read_auth_error(cause, true);
      if (error.code === "model.auth_required" || error.diagnostic_context["auth_invalid"] === true)
        this.emit();
      throw error;
    }
  }

  /** 任务会话与当前连接一致时才允许消费凭据。 */
  private read_session(session_id: string): ChatGPTCredential {
    this.lifetime.signal.throwIfAborted();
    const credential = this.store.read_account().credential;
    if (credential?.session_id !== session_id) throw new AppError("model.auth_required");
    return credential;
  }

  /** 网络刷新只占用所属会话的锁，退出与新登录始终可以提交本地状态。 */
  private async resolve_credential(session_id: string): Promise<ChatGPTCredential> {
    const credential = this.read_session(session_id);
    if (credential.expires > Date.now() + REFRESH_AHEAD_MS) return credential;
    return this.store.with_refresh_lock(session_id, async () => {
      const current = this.read_session(session_id);
      if (current.expires > Date.now() + REFRESH_AHEAD_MS) return current;
      let refreshed: ChatGPTCredential;
      try {
        refreshed = await refresh_chatgpt_credential(current, this.lifetime.signal);
      } catch (cause) {
        const error = read_auth_error(cause, true);
        if (error.diagnostic_context["auth_invalid"] === true)
          await this.store.update((account) => {
            if (account.credential?.session_id === session_id) account.credential = null;
          });
        throw error;
      }
      const saved = await this.store.update((account) => {
        // 刷新锁已串行本会话的轮换，本地提交只需复核当前会话归属。
        if (account.credential?.session_id !== session_id) return false;
        account.credential = refreshed;
        return true;
      });
      if (!saved) {
        // 退出或换号已提交，迟到的轮换凭据只能后台撤销，不能重新连接账户。
        this.revoke_in_background(refreshed);
        throw new AppError("model.auth_required");
      }
      return refreshed;
    });
  }

  /** 重复点击共用地址 Promise，启动、回调与落盘由同一完成链收尾。 */
  public async login(): Promise<ChatGPTLoginResponse> {
    if (this.pending?.controller.signal.aborted) await this.pending.completion;
    this.lifetime.signal.throwIfAborted();
    if (this.logging_out || this.gate.get_snapshot().owner !== null)
      throw new AppError("runtime.busy");
    let attempt = this.pending;
    if (attempt === null) {
      attempt = {
        id: randomUUID(),
        controller: new AbortController(),
        authorization: Promise.withResolvers<string>(),
        completion: Promise.resolve(),
      };
      this.pending = attempt;
      this.login_snapshot = { id: attempt.id, status: "pending" };
      this.revision += 1;
      attempt.completion = this.complete_login(attempt);
    }
    const url = await attempt.authorization.promise;
    return { id: attempt.id, url, snapshot: this.snapshot() };
  }

  /** 地址交付前的失败由 HTTP 返回，其后的授权结果通过账户事件交付。 */
  private async complete_login(attempt: LoginAttempt): Promise<void> {
    const signal = AbortSignal.any([
      attempt.controller.signal,
      this.lifetime.signal,
      AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    ]);
    let url_delivered = false; // URL 交付前的失败由调用者处理，之后从快照消费结果。
    let result: ChatGPTLoginSnapshot = { id: attempt.id, status: "cancelled" };
    let failure: AppError | undefined;
    try {
      const account = await this.store.update((current) => {
        signal.throwIfAborted();
        current.login_id = attempt.id;
        return structuredClone(current);
      });
      const login = await start_chatgpt_login({
        host_id: account.host_id,
        signal,
      });
      url_delivered = true;
      attempt.authorization.resolve(login.url);
      const credential = await login.completion;
      signal.throwIfAborted();
      await this.gate.run_model_auth_write(() =>
        this.store.update((current) => {
          signal.throwIfAborted();
          // 登录与退出都改写 `login_id`，以磁盘归属裁决迟到回调。
          if (current.login_id !== attempt.id) throw new AppError("runtime.cancelled");
          current.credential = credential;
          current.login_id = null;
        }),
      );
      result = { id: attempt.id, status: "succeeded" };
    } catch (error) {
      const failure_error =
        signal.aborted && !attempt.controller.signal.aborted && !this.lifetime.signal.aborted
          ? create_provider_error("ChatGPT sign-in timed out.")
          : read_auth_error(error);
      if (
        !attempt.controller.signal.aborted &&
        !this.lifetime.signal.aborted &&
        failure_error.code !== "runtime.cancelled"
      ) {
        failure = failure_error;
        result = { id: attempt.id, status: "failed", error: to_api_error_payload(failure_error) };
      }
    } finally {
      try {
        // 所有结束路径都清理自己的磁盘归属，不覆盖另一进程的新授权。
        if (result.status !== "succeeded")
          await this.store.update((current) => {
            if (current.login_id === attempt.id) current.login_id = null;
          });
      } catch (cause) {
        failure = read_auth_error(cause);
        result = { id: attempt.id, status: "failed", error: to_api_error_payload(failure) };
      }
      if (this.pending === attempt) {
        this.pending = null;
        this.login_snapshot = result;
        // URL 交付前的错误由 HTTP 返回，避免磁盘读取失败再次阻断错误交付。
        if (url_delivered) this.emit();
        else this.revision += 1;
      }
      if (!url_delivered)
        attempt.authorization.reject(failure ?? new AppError("runtime.cancelled"));
    }
  }

  /** 只取消指定授权；旧窗口迟到的取消请求不能影响新窗口。 */
  public async cancel_login(id: unknown): Promise<{ snapshot: ChatGPTAuthSnapshot }> {
    if (typeof id !== "string" || id === "") throw new AppError("request.validation_failed");
    const attempt = this.pending;
    if (attempt?.id === id) {
      attempt.controller.abort();
      await attempt.completion;
    }
    return { snapshot: this.snapshot() };
  }

  /** 本地提交即完成退出，远端清理不占用账户写锁或运行互斥。 */
  public async logout(): Promise<{ snapshot: ChatGPTAuthSnapshot }> {
    // 首个 await 前中止旧授权，短事务清除磁盘归属，使其迟到回调失效。
    const result = await this.gate.run_model_auth_write(async () => {
      this.logging_out = true;
      try {
        this.pending?.controller.abort();
        const previous = await this.store.update((account) => {
          const credential = account.credential;
          account.credential = null;
          account.login_id = null;
          return credential;
        });
        this.emit();
        return { previous, snapshot: this.snapshot() };
      } finally {
        this.logging_out = false;
      }
    });
    if (result.previous !== null) this.revoke_in_background(result.previous);
    return { snapshot: result.snapshot };
  }

  /** 凭据已离开本地账户，撤销失败不影响退出；服务关闭时中止，无需等待。 */
  private revoke_in_background(credential: ChatGPTCredential): void {
    void revoke_chatgpt_session(
      credential,
      AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(REVOKE_TIMEOUT_MS)]),
    ).catch(() => {
      // 网络或远端拒绝均不恢复已清除的连接，过期凭据由服务端自行收尾。
    });
  }

  /** 登录结果或连接失效推进修订，错误只附带可公开字段。 */
  private emit(): void {
    this.revision += 1;
    this.publish(MODEL_AUTH_CHANGED_EVENT_TOPIC, {
      snapshot: this.snapshot(),
    });
  }

  /** 等待登录与刷新收尾，防止关闭时丢失已轮换凭据。 */
  public async dispose(): Promise<void> {
    this.pending?.controller.abort();
    await this.pending?.completion;
    // 已开始的轮换先保存，再释放服务；网络交换自身有界。
    await Promise.allSettled(this.resolving);
    this.lifetime.abort();
  }
}

/** 应用错误保持原有 code，其余网络异常进入统一供应商错误边界。 */
function read_auth_error(cause: unknown, retryable = false): AppError {
  return cause instanceof AppError ? cause : create_provider_error(cause, undefined, { retryable });
}
