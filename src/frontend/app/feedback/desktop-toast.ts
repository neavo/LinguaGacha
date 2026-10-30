import { toast } from "sonner";
import { read_error_message } from "@shared/error/app-error";

type DesktopToastKind = "info" | "warning" | "success";
type DesktopToastId = string | number;
type DesktopToastAction = { label: string; onClick: () => void };
type DesktopToastOptions = {
  id?: DesktopToastId; // 持续状态以同一 ID 更新内容。
  description?: string; // 标题下方的具体结果。
  action?: DesktopToastAction;
  persistent?: boolean; // 需要用户确认的结果持续显示，使用已有关闭按钮。
  dismissible?: boolean; // 运行状态通知由拥有者随状态解除。
};
type ProgressToastOptions = {
  message: string;
  progress_percent?: number | undefined;
  presentation?: "inline" | "modal";
};
type ProgressToastState = Readonly<
  ProgressToastOptions & {
    owner_token: DesktopToastId;
    shown_at: number | null; // null 表示已锁定输入，视觉反馈仍在等待展示。
  }
>;

export const PROGRESS_TOAST_SONNER_ID = "desktop-progress-toast";
const PROGRESS_TOAST_DISMISS_DELAY_MS = 1500;
const MODAL_PROGRESS_SHOW_DELAY_MS = 250;
const MODAL_PROGRESS_MIN_VISIBLE_MS = 1000;
const ERROR_TOAST_DURATION_MS = 6000;
const progress_listeners = new Set<() => void>();
let progress_state: ProgressToastState | null = null; // 同一引用代表同一可观察快照
let progress_owner_seed = 0; // 任务身份独立于 Sonner 复用的展示 ID
let progress_timer: ReturnType<typeof setTimeout> | null = null; // 展示和关闭分阶段共用计时器。

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

/** 每次状态切换都取消旧计时，回调只提交创建计时时的快照。 */
function write_progress_toast(state: ProgressToastState | null): void {
  if (progress_timer !== null) clearTimeout(progress_timer);
  progress_timer = null;
  progress_state = state;
  for (const listener of progress_listeners) listener();
}

/** 错误与可恢复通知的阅读时长由统一入口拥有。 */
export function push_toast(
  kind: DesktopToastKind,
  message: string,
  options: DesktopToastOptions = {},
): DesktopToastId {
  const { id, description, action, persistent = false, dismissible } = options;
  return toast[kind](message, {
    ...(id === undefined ? {} : { id }),
    ...(description === undefined ? {} : { description }),
    ...(action === undefined ? {} : { action }),
    ...(dismissible === undefined ? {} : { dismissible, closeButton: dismissible }),
    ...(persistent || action !== undefined || dismissible === false
      ? { duration: Number.POSITIVE_INFINITY }
      : {}),
  });
}

/** 操作拥有者提供本地化标题，并负责一次失败通知。 */
export function push_error_toast(
  title: string,
  error: unknown,
  options: DesktopToastOptions = {},
): DesktopToastId {
  const { persistent, ...presentation } = options;
  return toast.error(title, {
    ...presentation,
    description: read_error_message(error),
    duration:
      persistent || options.action || options.dismissible === false
        ? Number.POSITIVE_INFINITY
        : ERROR_TOAST_DURATION_MS,
    ...(options.dismissible === undefined ? {} : { closeButton: options.dismissible }),
  });
}

/** 新任务取得唯一进度通知的所有权。 */
export function push_progress_toast(options: ProgressToastOptions): DesktopToastId {
  const owner_token = `${PROGRESS_TOAST_SONNER_ID}:${++progress_owner_seed}`;
  // 连续模态任务沿用可见时段，接管时不重新隐藏遮罩。
  let shown_at: number | null = Date.now();
  if (options.presentation === "modal") {
    shown_at = progress_state?.presentation === "modal" ? progress_state.shown_at : null;
  }
  const state: ProgressToastState = { ...options, owner_token, shown_at };
  write_progress_toast(state);
  if (shown_at === null) {
    progress_timer = setTimeout(() => {
      write_progress_toast({ ...state, shown_at: Date.now() });
    }, MODAL_PROGRESS_SHOW_DELAY_MS);
  }
  return owner_token;
}

/** 展示时序只延后界面关闭，任务结果仍按实际完成时间返回。 */
function finish_progress_toast(state: ProgressToastState): void {
  if (state.presentation === "modal") {
    const remaining_ms =
      state.shown_at === null ? 0 : MODAL_PROGRESS_MIN_VISIBLE_MS - (Date.now() - state.shown_at);
    if (remaining_ms <= 0) {
      write_progress_toast(null);
    } else if (progress_timer === null) {
      // 重复关闭沿用原计时，最短展示时长从 shown_at 开始。
      progress_timer = setTimeout(() => write_progress_toast(null), remaining_ms);
    }
    return;
  }
  write_progress_toast({ ...state, progress_percent: undefined });
  progress_timer = setTimeout(() => write_progress_toast(null), PROGRESS_TOAST_DISMISS_DELAY_MS);
}

/** 进度按任务身份关闭，普通通知按 Sonner ID 关闭。 */
export function dismiss_toast(toast_id?: DesktopToastId): void {
  if (toast_id === undefined) {
    for (const { id } of toast.getToasts()) {
      if (id !== PROGRESS_TOAST_SONNER_ID) toast.dismiss(id);
    }
    if (progress_state !== null) finish_progress_toast(progress_state);
  } else if (progress_state?.owner_token === toast_id) {
    finish_progress_toast(progress_state);
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

/** 任务结束或超时后提交关闭。超时只停止等待，调用方任务继续执行。 */
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
