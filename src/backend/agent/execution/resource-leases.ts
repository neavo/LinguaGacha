import type { WorkspaceResource } from "../workspace/runtime/protocol";
import { wait_for_operation } from "../wait-for-operation";

/** 资源各自排队。等待可取消，已取得的占用由进程监管走完后负责兜底释放。 */
export class WorkspaceResourceLeases {
  private readonly pending = new Map<WorkspaceResource, Promise<void>>();

  /** 取消等待时归还自己的排队位置，后续请求仍按原顺序取得资源。 */
  public async acquire(resource: WorkspaceResource, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    const turn = this.pending.get(resource) ?? Promise.resolve();
    const release = Promise.withResolvers<void>();
    const tail = turn.then(() => release.promise);
    this.pending.set(resource, tail);
    void tail.then(() => {
      if (this.pending.get(resource) === tail) this.pending.delete(resource);
    });

    try {
      await wait_for_operation(turn, signal);
      return () => release.resolve();
    } catch (error) {
      release.resolve();
      throw error;
    }
  }
}
