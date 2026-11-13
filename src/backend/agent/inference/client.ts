import { Worker } from "node:worker_threads";
import type { ChannelHeader } from "./channel";
/** 资源收尾的统一等待上限。超时说明原生或子进程收尾卡住，只能交给工作区监管器。 */
export const CLOSE_TIMEOUT_MS = 30_000;

/** GPU 通道执行失败。调用者在安全收尾后决定是否改用 CPU。 */
export class DeviceFailure extends Error {
  override name = "DeviceFailure";
}

/** 调用方决定通道归属，客户端只管理各通道的线程。 */
type Lane = string;

/** 两个推理领域共用请求关联、失败结算与线程收尾。 */
export class InferenceClient {
  private readonly workers = new Map<Lane, Readonly<{ worker: Worker; exited: Promise<number> }>>();
  private readonly pending = new Map<
    number,
    Readonly<{
      lane: Lane;
      resolve: (reply: Reply) => void;
      reject: (error: Error) => void;
    }>
  >();
  private next = 0; // 请求编号，只用于关联应答。
  private failure: Error | undefined; // 首个致命错误，之后的请求直接拒绝。
  private closing: Promise<void> | undefined;
  private shutdown_error: Error | undefined; // 关闭期间 Worker 报出的错误。

  /** 保存独立执行配置，首次请求才创建 Worker。 */
  constructor(
    private readonly config: unknown,
    private readonly worker_file: string,
  ) {}

  /** 通道的 Worker 按需创建。非关闭期间的退出或错误都使整个引擎失败。 */
  private worker(lane: Lane): Worker {
    let current = this.workers.get(lane);
    if (!current) {
      const worker = new Worker(this.worker_file, { workerData: this.config });
      const exited = new Promise<number>((resolve) => worker.once("exit", resolve));
      worker.on("message", (reply: WorkerReply) => this.settle(reply));
      worker.on("error", (error) => {
        if (this.closing) this.shutdown_error ??= error;
        this.fail(this.attribute(lane, error));
      });
      void exited.then((code) => {
        if (
          !this.closing ||
          code !== 0 ||
          [...this.pending.values()].some((request) => request.lane === lane)
        )
          this.fail(this.attribute(lane, new Error(`Inference worker exited (${code}).`)));
      });
      current = { worker, exited };
      this.workers.set(lane, current);
    }
    return current.worker;
  }

  /** 释放等控制消息只发送到已有通道，不为收尾额外创建 Worker。 */
  send(lane: string, message: unknown): void {
    if (!this.failure) this.workers.get(lane)?.worker.postMessage(message);
  }

  /** 载荷所在的 ArrayBuffer 转移给 Worker，调用者之后不能再使用它。 */
  request(
    lane: string,
    fields: Readonly<Record<string, string | number>>,
    header: ChannelHeader,
    payload: Uint8Array<ArrayBuffer>,
  ): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing) return Promise.reject(new Error("Inference client is closing."));
    if (payload.byteOffset !== 0 || payload.byteLength !== payload.buffer.byteLength)
      throw new Error("Inference payload must own its buffer.");
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { lane, resolve, reject });
      const message = {
        type: "infer",
        id,
        ...fields,
        header,
        payload: payload.buffer,
      };
      try {
        this.worker(lane).postMessage(message, [payload.buffer]);
      } catch (error) {
        this.fail(this.attribute(lane, error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  /** 关闭只发生一次：请求释放会话，等待线程自然退出。 */
  close(): Promise<void> {
    this.closing ??= (async () => {
      const close = { type: "close" };
      for (const { worker } of this.workers.values()) worker.postMessage(close); // 已退出的 Worker 忽略消息。
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CLOSE_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        Promise.all([...this.workers.values()].map(({ exited }) => exited)),
        timeout,
      ]);
      clearTimeout(timer);
      if (outcome === "timeout") {
        throw new Error(
          `Inference worker did not exit within ${CLOSE_TIMEOUT_MS / 1000}s; the host must end this run.`,
        );
      }
      if (this.shutdown_error) throw this.shutdown_error;
      if (!this.failure && outcome.some((code) => code !== 0))
        throw new Error(`Inference workers failed to close: ${outcome}`);
    })();
    return this.closing;
  }

  /** 应答按编号交还等待者。GPU 通道的失败应答同时使引擎失败。 */
  private settle(reply: WorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return this.fail(new Error(`Unknown inference worker reply: ${reply.id}`));
    this.pending.delete(reply.id);
    if ("error" in reply) {
      const error = this.attribute(pending.lane, new Error(reply.error));
      pending.reject(error);
      if (error instanceof DeviceFailure) this.fail(error);
    } else pending.resolve(reply);
  }

  /** 只把 GPU 通道错误标记为设备失败，CPU 错误保持原样。 */
  private attribute(lane: Lane, error: Error): Error {
    if (lane !== "gpu") return error;
    return new DeviceFailure(error.message, { cause: error });
  }

  /** 记录首个失败，拒绝全部在途请求并开始关闭。 */
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    // 调用方在关闭引擎时收到收尾结果，这里只避免未处理的拒绝。
    this.close().catch(() => undefined);
  }
}

/** 成功应答：结果头与可选的二进制载荷。 */
type Reply = Readonly<{ header: ChannelHeader; payload?: ArrayBuffer }>;

type WorkerReply = { id: number; error: string } | ({ id: number } & Reply);
