import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { default_native_fs } from "./native-fs";
import { AppError } from "../shared/error";

export type SupervisedProcessResult = Readonly<{ exitCode: number | null; signal: string | null }>;
export type SupervisedProcessLaunch = Readonly<{
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: string;
  stderr: string;
}>;

/** 控制回执来自独立监管程序，目标日志不经过此通道。 */
type SupervisorEvent = SupervisedProcessResult & {
  type: string;
  pid?: number;
  code?: string;
  message?: string;
};

/** 一次操作持有租约，准备程序、npm 与原生 fork 在租约内顺序执行。 */
export class Supervisor {
  private readonly events: SupervisorEvent[] = []; // 同批到达的回执按各阶段分别消费。
  private changed: (() => void) | undefined; // 控制协议顺序执行，同一时刻只有一个等待点。
  private failure: unknown; // 首个失败拥有本次结果，迟到的取消或管道错误只触发收尾。
  private closed = false;
  private failure_reported = false; // wait 已交出故障后，close 只清理，避免重复包装主因。
  private group: number | undefined; // POSIX 监管程序消失时，宿主接管此进程组。
  private readonly completion: Promise<void>;
  private readonly child: ChildProcessWithoutNullStreams;

  /** 控制管道和目标标准流分开，原生程序退出后才结算连接。 */
  private constructor(
    executable: string,
    lock: string,
    private readonly lock_handle?: Awaited<ReturnType<typeof default_native_fs.open_file>>,
  ) {
    this.child = spawn(executable, [lock], {
      windowsHide: true,
      detached: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe", ...(lock_handle === undefined ? [] : [lock_handle.fd])],
    }) as ChildProcessWithoutNullStreams;
    let diagnostics = "";
    this.child.stderr.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const event: SupervisorEvent = JSON.parse(line);
        if (event.type === "fault") {
          this.failure ??=
            event.code === "runtime.busy"
              ? new AppError("runtime.busy")
              : new Error(event.message ?? "Process supervisor failed.");
        } else {
          if (event.type === "ready") this.group = event.pid;
          if (event.type === "drained") this.group = undefined;
          this.events.push(event);
        }
      } catch (error) {
        this.failure ??= error;
      }
      this.changed?.();
    });
    this.child.stdin.on("error", (error) => {
      this.failure ??= error;
      this.changed?.();
    });
    this.child.on("error", (error) => {
      this.failure ??= error;
      this.changed?.();
    });
    this.completion = new Promise((resolve) =>
      this.child.once("close", (code) => {
        this.closed = true;
        if (code !== 0 && this.failure === undefined)
          this.failure = new Error(`Process supervisor exited (${code}): ${diagnostics}`);
        this.changed?.();
        resolve();
      }),
    );
  }

  /** POSIX 两端持有同一锁描述，单端退出不会提前释放租约。 */
  public static async acquire(
    runtime: string,
    lock: string,
    signal?: AbortSignal,
  ): Promise<Supervisor> {
    signal?.throwIfAborted();
    default_native_fs.make_dir(path.dirname(lock));
    const handle =
      process.platform === "win32" ? undefined : await default_native_fs.open_file(lock, "a+");
    const executable = path.join(
      runtime,
      "bin",
      `${process.platform}-${process.arch}`,
      process.platform === "win32" ? "supervisor.exe" : "supervisor",
    );
    const owner = new Supervisor(executable, lock, handle);
    const abort = () => {
      owner.failure ??= signal?.reason;
      owner.failure_reported = true; // acquire 交付失败原因，close 只回收资源。
      owner.child.stdin.end(); // EOF 也覆盖尚未收到租约回执的阶段。
      owner.changed?.();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      await owner.wait("leased");
      signal?.throwIfAborted();
      return owner;
    } catch (error) {
      await owner.close().catch((cleanup: unknown) => {
        throw new AggregateError(
          [error, cleanup],
          "Process supervisor acquisition and cleanup failed.",
          { cause: error },
        );
      });
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  /** 参数与环境作为数据传给监管程序，启动和后代回收共用本次租约。 */
  public async launch(
    command: SupervisedProcessLaunch,
    signal: AbortSignal,
  ): Promise<SupervisedProcessResult> {
    signal.throwIfAborted();
    this.send({
      type: "launch",
      ...command,
      env: Object.entries(command.env)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([name, value]) => `${name}=${value}`),
    });
    return await this.settle(signal, true);
  }

  /** bootstrap 在等待 start，此处登记成功后 Runner 才能放行。 */
  public async attach(pid: number): Promise<void> {
    this.send({ type: "attach", pid });
    await this.wait("ready");
  }

  /** 停止请求只发给存活的监管程序，异常退出由收尾路径接管。 */
  public stop(): void {
    if (!this.closed && this.failure === undefined) this.send({ type: "stop" });
  }

  /** 即使目标被取消，也先等待后代回收，再把原始取消原因交回调用者。 */
  public async settle(signal: AbortSignal, launching = false): Promise<SupervisedProcessResult> {
    const abort = () => this.stop();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      if (launching) {
        await this.wait("ready");
        if (process.platform !== "win32" && !signal.aborted) this.send({ type: "resume" });
      }
      const result = await this.wait("exited");
      await this.wait("drained");
      signal.throwIfAborted();
      return { exitCode: result.exitCode, signal: result.signal };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /** 控制消息独占一行，目标的任意输出不会参与协议解析。 */
  private send(value: object): void {
    if (this.closed) throw this.failure ?? new Error("Process supervisor is closed.");
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  /** 先投递监管故障，防止迟到的成功回执覆盖失败。 */
  private async wait(type: string): Promise<SupervisorEvent> {
    for (;;) {
      if (this.failure !== undefined) {
        this.failure_reported = true;
        throw this.failure;
      }
      const index = this.events.findIndex((event) => event.type === type);
      if (index >= 0) return this.events.splice(index, 1)[0]!;
      if (this.closed) throw new Error(`Process supervisor closed before ${type}.`);
      await new Promise<void>((resolve) => {
        this.changed = resolve;
      });
      this.changed = undefined;
    }
  }

  /** 操作拥有者在结算后释放租约，收尾故障继续交回同一调用者。 */
  public async close(): Promise<void> {
    if (!this.closed && this.failure === undefined && this.group === undefined) {
      this.send({ type: "release" });
      try {
        await this.wait("released");
      } catch (error) {
        this.failure ??= error;
        this.failure_reported = false;
      }
    }
    if (!this.closed) this.child.stdin.end(); // EOF 让监管程序回收，再关闭自己的锁句柄。
    await this.completion;
    try {
      if (process.platform !== "win32" && this.group !== undefined) {
        // 监管程序消失后，宿主持有的同一锁描述继续阻挡其他实例。
        const group = this.group;
        try {
          process.kill(-group, "SIGKILL");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
        const deadline = Date.now() + 30_000;
        for (;;) {
          try {
            process.kill(-group, 0);
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ESRCH") break;
            throw error;
          }
          if (Date.now() >= deadline) throw new Error("Supervised process group did not drain.");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      if (this.failure !== undefined && !this.failure_reported) throw this.failure;
    } finally {
      await this.lock_handle?.close();
    }
  }
}
