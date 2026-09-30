import { randomUUID } from "node:crypto";
import { createModels, createProvider, type ModelAuth } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { AppError, to_api_error_payload } from "../../shared/error";
import { MODEL_AUTH_CHANGED_EVENT_TOPIC, type ChatGPTAuthSnapshot } from "../../shared/model-auth";
import type { JsonRecord } from "../../domain/json";
import type { AppPathService } from "../app/app-path-service";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { without_http_response_info } from "../network/http-response-info";
import { create_provider_error } from "../network/provider-error";
import { ChatGPTCredentialStore } from "./chatgpt-credential-store";
import { chatgpt_oauth, start_chatgpt_login, revoke_chatgpt_session } from "./chatgpt-oauth";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;
const REVOKE_TIMEOUT_MS = 15_000;
type LoginAttempt = {
  id: string; // 跨进程回调归属，与文件中的 login_id 对应。
  controller: AbortController; // 当前授权尝试的取消源。
  authorization: PromiseWithResolvers<string>; // 首次启动期间的重复点击等待同一授权地址。
  completion: Promise<void>; // 从监听启动覆盖到凭据落盘和资源清理。
};

/** 应用级账户拥有者；模型只引用当前连接，GUI 和 CLI 共用同一文件存储。 */
export class ChatGPTAuthService {
  private readonly store: ChatGPTCredentialStore; // 唯一持久化入口与跨进程刷新锁。
  private readonly models: ReturnType<typeof createModels>; // Pi 只负责凭据解析与到期判断。
  private readonly lifetime = new AbortController(); // 服务关闭后拒绝新凭据请求。
  private readonly resolving = new Set<Promise<unknown>>(); // 关闭时等待已经开始的 token 轮换落盘。
  private readonly instance_id = randomUUID(); // `revision` 的后端实例归属。
  private revision = 0; // 拒绝 HTTP 与 SSE 的迟到快照。
  private pending: LoginAttempt | null = null; // 浏览器授权由后端持有，页面切换不影响它。

  /** 装配单账户认证与存储，OAuth 失败保持显式错误语义。 */
  public constructor(
    paths: AppPathService,
    private readonly gate: RuntimeOperationGate,
    private readonly publish: (topic: string, payload: JsonRecord) => void,
  ) {
    this.store = new ChatGPTCredentialStore(paths.get_user_data_path("auth", "chatgpt.json"));
    this.models = createModels({ credentials: this.store });
    // 此集合只解析 ChatGPT 凭据，禁用环境 API Key 回退，避免隐式改变计费路径。
    this.models.setProvider(
      createProvider({
        id: "openai",
        models: [],
        auth: { oauth: chatgpt_oauth },
        api: openAIResponsesApi(),
      }),
    );
  }

  /** 两态界面只消费是否连接，注册身份与授权地址留在各自操作边界。 */
  public snapshot(): ChatGPTAuthSnapshot {
    const account = this.store.read_account();
    return {
      instance_id: this.instance_id,
      revision: this.revision,
      connected: account.credential !== null,
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
    this.assert_session(session_id);
    const operation = without_http_response_info(() =>
      this.models.getAuth("openai", { signal: this.lifetime.signal }),
    ).finally(() => {
      this.resolving.delete(operation);
    });
    this.resolving.add(operation);
    try {
      const result =
        signal === undefined ? await operation : await raceWithAbortSignal(operation, signal);
      // 解析可能跨过另一进程的账户替换，返回前复核本轮身份。
      this.assert_session(session_id);
      signal?.throwIfAborted();
      if (result === undefined) throw new AppError("model.auth_required");
      return result.auth;
    } catch (cause) {
      signal?.throwIfAborted();
      const error = read_auth_error(cause, true);
      if (error.code === "model.auth_required" || error.diagnostic_context["auth_invalid"] === true)
        this.emit();
      throw error;
    }
  }

  /** 任务会话与当前连接一致时才允许消费凭据。 */
  private assert_session(session_id: string): void {
    this.lifetime.signal.throwIfAborted();
    if (this.store.read_account().credential?.session_id !== session_id) {
      this.emit();
      throw new AppError("model.auth_required");
    }
  }

  /** 重复点击共用地址 Promise，启动、回调与落盘由同一完成链收尾。 */
  public async login(): Promise<string> {
    this.lifetime.signal.throwIfAborted();
    if (this.pending !== null) return this.pending.authorization.promise;
    if (this.gate.get_snapshot().owner !== null) throw new AppError("runtime.busy");
    const attempt: LoginAttempt = {
      id: randomUUID(),
      controller: new AbortController(),
      authorization: Promise.withResolvers<string>(),
      completion: Promise.resolve(),
    };
    this.pending = attempt;
    attempt.completion = this.complete_login(attempt);
    return attempt.authorization.promise;
  }

  /** 地址交付前的失败由 HTTP 返回，其后的授权结果通过账户事件交付。 */
  private async complete_login(attempt: LoginAttempt): Promise<void> {
    const signal = AbortSignal.any([
      attempt.controller.signal,
      this.lifetime.signal,
      AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    ]);
    let browser_started = false; // 同一次失败只走一个反馈入口。
    let failure: AppError | undefined;
    try {
      const account = await this.store.update(async (current) => {
        signal.throwIfAborted();
        current.login_id = attempt.id;
        return structuredClone(current);
      });
      const previous_session = account.credential?.session_id ?? null;
      const login = await start_chatgpt_login({
        host_id: account.host_id,
        registration: account.registration,
        signal,
      });
      browser_started = true;
      attempt.authorization.resolve(login.url);
      const credential = await login.completion;
      signal.throwIfAborted();
      await this.gate.run_model_auth_write(() =>
        this.store.update(async (current) => {
          signal.throwIfAborted();
          if (
            this.pending !== attempt ||
            current.login_id !== attempt.id ||
            (current.credential?.session_id ?? null) !== previous_session
          )
            throw new AppError("runtime.cancelled");
          current.registration = {
            client_id: credential.clientId,
            subject: credential.subject,
            email: credential.email,
          };
          current.credential = credential;
          current.login_id = null;
        }),
      );
    } catch (error) {
      const failure_error =
        signal.aborted && !attempt.controller.signal.aborted && !this.lifetime.signal.aborted
          ? create_provider_error("ChatGPT sign-in timed out.")
          : read_auth_error(error);
      if (!browser_started) attempt.authorization.reject(failure_error);
      else if (
        !attempt.controller.signal.aborted &&
        !this.lifetime.signal.aborted &&
        failure_error.code !== "runtime.cancelled"
      )
        failure = failure_error;
    } finally {
      if (this.pending === attempt) {
        this.pending = null;
        if (browser_started) this.emit(failure);
      }
    }
  }

  /** 退出先取消浏览器操作，再让该操作完成文件与监听器清理。 */
  private async cancel_login(): Promise<void> {
    const attempt = this.pending;
    attempt?.controller.abort();
    await attempt?.completion;
    if (attempt !== null)
      await this.store.update(async (account) => {
        if (account.login_id === attempt.id) account.login_id = null;
      });
  }

  /** 远端撤销为尽力操作，本地退出始终通过存储锁清除凭据。 */
  public async logout(): Promise<{ snapshot: ChatGPTAuthSnapshot }> {
    // 首个 await 前取得运行互斥，取消登录与等待刷新期间也不能启动新任务。
    return this.gate.run_model_auth_write(async () => {
      await this.cancel_login();
      await this.store.update(async (account) => {
        if (account.credential !== null) {
          try {
            await revoke_chatgpt_session(
              account.credential,
              AbortSignal.timeout(REVOKE_TIMEOUT_MS),
            );
          } catch {
            // 离线也允许退出，本次操作接下来会清除全部本地 token。
          }
        }
        account.credential = null;
        account.login_id = null;
      });
      this.emit();
      return { snapshot: this.snapshot() };
    });
  }

  /** 登录结果或连接失效推进修订，错误只附带可公开字段。 */
  private emit(error?: AppError): void {
    this.revision += 1;
    this.publish(MODEL_AUTH_CHANGED_EVENT_TOPIC, {
      snapshot: this.snapshot(),
      ...(error === undefined
        ? {}
        : { error: to_api_error_payload(error) as unknown as JsonRecord }),
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

/** Pi 在 cause 中保留应用错误，公开层继续消费稳定 code。 */
function read_auth_error(cause: unknown, retryable = false): AppError {
  let original = cause;
  for (let current = cause; current instanceof Error; current = current.cause) {
    if (current instanceof AppError) return current;
    original = current;
  }
  return create_provider_error(original, undefined, { retryable });
}
