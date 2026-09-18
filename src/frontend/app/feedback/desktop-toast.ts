import { toast } from "sonner";

type DesktopToastKind = "info" | "warning" | "error" | "success";
type DesktopToastId = string | number;
type DesktopToastAction = { label: string; onClick: () => void };
type ProgressToastOptions = {
  message: string;
  progress_percent?: number;
  presentation?: "inline" | "modal";
};
type ProgressToastState = Readonly<ProgressToastOptions & { owner_token: DesktopToastId }>;

export const PROGRESS_TOAST_SONNER_ID = "desktop-progress-toast";
const PROGRESS_TOAST_DISMISS_DELAY_MS = 1500;
const ERROR_TOAST_DURATION_MS = 6000;
const progress_listeners = new Set<() => void>();
let progress_state: ProgressToastState | null = null; // 同一引用代表同一可观察快照
let progress_owner_seed = 0; // 任务身份独立于 Sonner 复用的展示 ID
let dismiss_timer: ReturnType<typeof setTimeout> | null = null; // 接管任务或关闭时取消旧计时

/** 进度动作和展示共用窗口内唯一快照，展示模块更新时仍保留任务身份。 */
export function read_progress_toast(): ProgressToastState | null {
  return progress_state;
}

/** 订阅生命周期归展示组件，卸载时只解除自己的监听。 */
export function subscribe_progress_toast(listener: () => void): () => void {
  progress_listeners.add(listener);
  return () => {
    progress_listeners.delete(listener);
  };
}

/** 写入前取消旧关闭任务，再发布同一份不可变快照。 */
function write_progress_toast(state: ProgressToastState | null): void {
  if (dismiss_timer !== null) clearTimeout(dismiss_timer);
  dismiss_timer = null;
  progress_state = state;
  for (const listener of progress_listeners) listener();
}

/** 错误与可恢复通知的阅读时长由统一入口拥有。 */
export function push_toast(
  kind: DesktopToastKind,
  message: string,
  action?: DesktopToastAction,
): DesktopToastId {
  return toast[kind](
    message,
    action !== undefined
      ? { action, duration: Number.POSITIVE_INFINITY }
      : kind === "error"
        ? { duration: ERROR_TOAST_DURATION_MS }
        : undefined,
  );
}

/** 新任务取得唯一进度通知的所有权。 */
export function push_progress_toast(options: ProgressToastOptions): DesktopToastId {
  const owner_token = `${PROGRESS_TOAST_SONNER_ID}:${++progress_owner_seed}`;
  write_progress_toast({ ...options, owner_token });
  return owner_token;
}

/** 旧任务的迟到回调只能操作自己的通知。 */
export function update_progress_toast(
  toast_id: DesktopToastId,
  options: ProgressToastOptions,
): DesktopToastId {
  if (progress_state?.owner_token === toast_id) {
    write_progress_toast({ ...options, owner_token: toast_id });
  }
  return toast_id;
}

/** 模态任务立即释放遮罩，普通进度短暂保留完成反馈。 */
function finish_progress_toast(owner_token: DesktopToastId): void {
  if (progress_state?.owner_token !== owner_token) return;
  if (progress_state.presentation === "modal") {
    write_progress_toast(null);
    return;
  }
  write_progress_toast({ ...progress_state, progress_percent: undefined });
  dismiss_timer = setTimeout(() => {
    if (progress_state?.owner_token === owner_token) write_progress_toast(null);
  }, PROGRESS_TOAST_DISMISS_DELAY_MS);
}

/** 进度按任务身份关闭，普通通知按 Sonner ID 关闭。 */
export function dismiss_toast(toast_id?: DesktopToastId): void {
  if (toast_id === undefined) {
    for (const { id } of toast.getToasts()) {
      if (id !== PROGRESS_TOAST_SONNER_ID) toast.dismiss(id);
    }
    if (progress_state !== null) finish_progress_toast(progress_state.owner_token);
  } else if (progress_state?.owner_token === toast_id) {
    finish_progress_toast(toast_id);
  } else {
    toast.dismiss(toast_id);
  }
}

/** 调用方通过稳定错误类型识别模态进度超时。 */
export class ModalProgressToastTimeoutError extends Error {
  public readonly code = "modal_progress_timeout"; // 通知超时的诊断标识
  /** 错误消息供诊断使用，用户文案由调用方决定。 */
  public constructor() {
    super("ui_runtime.modal_progress_timeout");
    this.name = "ModalProgressToastTimeoutError";
  }
}

/** 任务结束或超时后释放其拥有的进度，超时不会取消调用方任务。 */
export async function run_modal_progress_toast<T>(args: {
  message: string;
  task: () => Promise<T>;
  timeout_ms?: number;
}): Promise<T> {
  const id = push_progress_toast({ message: args.message, presentation: "modal" });
  let timeout_id: ReturnType<typeof setTimeout> | null = null;
  try {
    if (args.timeout_ms === undefined) return await args.task();
    return await Promise.race([
      args.task(),
      new Promise<never>((_resolve, reject) => {
        timeout_id = setTimeout(
          () => reject(new ModalProgressToastTimeoutError()),
          args.timeout_ms,
        );
      }),
    ]);
  } finally {
    if (timeout_id !== null) clearTimeout(timeout_id);
    dismiss_toast(id);
  }
}
