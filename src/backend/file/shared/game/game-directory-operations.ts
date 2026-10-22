import path from "node:path";
import { default_native_fs, type NativeFs } from "../../../../native/native-fs";
import { AppError } from "../../../../shared/error";

/** 文件域独占目录范围，停止时等待业务恢复和清理真正结束。 */
export class GameDirectoryOperations {
  private readonly lifetime = new AbortController(); // 停止后永久拒绝新操作。
  private readonly active = new Map<readonly string[], Promise<void>>(); // Promise 在业务收尾后完成。

  public constructor(private readonly fs: NativeFs = default_native_fs) {}

  /** 整批检查并取得目录占用，异常和取消都由业务完成收尾后释放。 */
  public async run<T>(
    directories: readonly string[],
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    combined.throwIfAborted();
    const roots = directories.map((directory) => this.fs.to_identity_path(directory));
    for (const occupied of this.active.keys()) {
      const conflict = roots.find((root) =>
        occupied.some((other) => contains(root, other) || contains(other, root)),
      );
      if (conflict !== undefined)
        throw new AppError("file.busy", {
          message: "The game directory is busy: " + conflict,
          public_details: { directory: conflict },
        });
    }
    // 检查、登记和停止快照之间不能让出执行，回调收尾后才释放范围。
    const { promise, resolve } = Promise.withResolvers<void>();
    this.active.set(roots, promise);
    try {
      return await operation(combined);
    } finally {
      this.active.delete(roots);
      resolve();
    }
  }

  /** 同步关闭入口并取消在途操作，等待恢复和清理完成。 */
  public async stop(): Promise<void> {
    this.lifetime.abort(new AppError("runtime.disposed"));
    await Promise.all(this.active.values());
  }
}

/** 比较路径分量，避免相邻目录名被当作父子目录。 */
function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep))
  );
}
