import { useCallback, useMemo, useSyncExternalStore } from "react";

import { toast } from "sonner";
import { ProgressToastRing } from "@frontend/widgets/progress-toast-ring/progress-toast-ring";

type DesktopToastKind = "info" | "warning" | "error" | "success";

type DesktopToastId = string | number;

type ProgressToastPresentation = "inline" | "modal";

type ProgressToastOptions = {
  message: string;
  progress_percent?: number;
  presentation?: ProgressToastPresentation;
};

type ProgressToastState = {
  owner_token: DesktopToastId;
  message: string;
  progress_percent?: number;
  presentation: ProgressToastPresentation;
  dismiss_timer: ReturnType<typeof setTimeout> | null;
};

type DesktopToastApi = {
  push_toast: (kind: DesktopToastKind, message: string) => DesktopToastId;
  push_progress_toast: (options: ProgressToastOptions) => DesktopToastId;
  update_progress_toast: (
    toast_id: DesktopToastId,
    options: ProgressToastOptions,
  ) => DesktopToastId;
  dismiss_toast: (toast_id?: DesktopToastId) => void;
  run_modal_progress_toast: <T>(args: {
    message: string;
    task: () => Promise<T>;
    timeout_ms?: number;
  }) => Promise<T>;
};

/**
 * ModalProgressToastTimeoutError 表示模态进度任务超时，页面只按 name/code 做兜底处理。
 */
export class ModalProgressToastTimeoutError extends Error {
  public readonly code = "modal_progress_timeout"; // 进度 toast 超时的稳定诊断标识

  /**
   * message 使用非展示诊断标识，避免超时异常文本直接进入 toast。
   */
  public constructor() {
    super("ui_runtime.modal_progress_timeout");
    this.name = "ModalProgressToastTimeoutError";
  }
}

const PROGRESS_TOAST_DISMISS_DELAY_MS = 1500;
const ERROR_TOAST_DURATION_MS = 6000;
const PROGRESS_TOAST_SONNER_ID = "desktop-progress-toast";
const progress_toast_modal_listener_set = new Set<() => void>();
let progress_toast_state: ProgressToastState | null = null;
let progress_toast_owner_token_seed = 0;

/** 通知遮罩订阅者重新读取当前进度展示状态。 */
function emit_progress_toast_modal_change(): void {
  for (const listener of progress_toast_modal_listener_set) {
    listener();
  }
}

/** 提供 useSyncExternalStore 使用的稳定遮罩快照入口。 */
function read_progress_toast_modal_active(): boolean {
  return progress_toast_state?.presentation === "modal";
}

/** 按挂载周期管理遮罩订阅者。 */
function subscribe_progress_toast_modal(listener: () => void): () => void {
  progress_toast_modal_listener_set.add(listener);

  return () => {
    progress_toast_modal_listener_set.delete(listener);
  };
}

/** 进度展示复用同一 Sonner 通知，owner 负责区分调用任务。 */
function render_progress_toast(options: ProgressToastOptions): void {
  toast(options.message, {
    id: PROGRESS_TOAST_SONNER_ID,
    icon: <ProgressToastRing progress_percent={options.progress_percent} />,
    position: "bottom-center",
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
    closeButton: false,
    classNames: {
      toast: `cn-toast cn-toast--progress${options.presentation === "modal" ? " cn-toast--progress-modal" : ""}`,
    },
  });
}
/** 接替进度任务时取消旧关闭计时，并发布当前 owner 的展示。 */
function sync_progress_toast_state(
  owner_token: DesktopToastId,
  options: ProgressToastOptions,
): void {
  const previous_state = progress_toast_state;

  if (previous_state?.dismiss_timer != null) {
    clearTimeout(previous_state.dismiss_timer);
  }

  const presentation = options.presentation ?? "inline";
  progress_toast_state = {
    owner_token,
    message: options.message,
    progress_percent: options.progress_percent,
    presentation,
    dismiss_timer: null,
  };
  render_progress_toast(progress_toast_state);
  emit_progress_toast_modal_change();
}

/** 当前任务结束后释放模态遮罩，普通进度保留短暂完成反馈。 */
function schedule_progress_toast_dismiss(owner_token: DesktopToastId): void {
  const current_progress_state = progress_toast_state;

  if (current_progress_state === null || current_progress_state.owner_token !== owner_token) {
    return;
  }

  if (current_progress_state.dismiss_timer != null) {
    clearTimeout(current_progress_state.dismiss_timer);
  }

  if (current_progress_state.presentation === "modal") {
    progress_toast_state = null;
    toast.dismiss(PROGRESS_TOAST_SONNER_ID);
    emit_progress_toast_modal_change();
    return;
  }

  if (current_progress_state.progress_percent !== undefined) {
    render_progress_toast({
      message: current_progress_state.message,
      progress_percent: undefined,
      presentation: current_progress_state.presentation,
    });
    current_progress_state.progress_percent = undefined;
  }

  current_progress_state.dismiss_timer = setTimeout(() => {
    if (progress_toast_state?.owner_token !== owner_token) {
      return;
    }

    progress_toast_state = null;
    toast.dismiss(PROGRESS_TOAST_SONNER_ID);
    emit_progress_toast_modal_change();
  }, PROGRESS_TOAST_DISMISS_DELAY_MS);
}

/** 主窗口按进度展示状态挂载输入遮罩。 */
export function DesktopProgressToastModalLayer(): JSX.Element | null {
  const modal_active = useSyncExternalStore(
    subscribe_progress_toast_modal,
    read_progress_toast_modal_active,
    () => false,
  );

  if (!modal_active) {
    return null;
  }

  return <div className="cn-progress-toast-modal-layer" aria-hidden="true" />;
}

/** 页面共用稳定的通知动作，进度通知由任务 owner 管理。 */
export function useDesktopToast(): DesktopToastApi {
  /** 按通知类型统一错误阅读时长。 */
  const push_toast = useCallback((kind: DesktopToastKind, message: string): DesktopToastId => {
    return toast[kind](
      message,
      kind === "error" ? { duration: ERROR_TOAST_DURATION_MS } : undefined,
    );
  }, []);

  /** 为本次进度任务分配独立于 Sonner 自动 ID 的身份。 */
  const push_progress_toast = useCallback((options: ProgressToastOptions): DesktopToastId => {
    const owner_token = `${PROGRESS_TOAST_SONNER_ID}:${++progress_toast_owner_token_seed}`;
    sync_progress_toast_state(owner_token, options);
    return owner_token;
  }, []);

  /** 只有当前 owner 可以更新进度。 */
  const update_progress_toast = useCallback(
    (toast_id: DesktopToastId, options: ProgressToastOptions): DesktopToastId => {
      if (progress_toast_state === null || progress_toast_state.owner_token !== toast_id) {
        return toast_id;
      }

      sync_progress_toast_state(toast_id, options);
      return toast_id;
    },
    [],
  );

  /** 普通通知直接关闭，进度通知交给 owner 结束展示。 */
  const dismiss_toast = useCallback((toast_id?: DesktopToastId): void => {
    if (toast_id === undefined) {
      for (const { id } of toast.getToasts()) {
        if (id !== PROGRESS_TOAST_SONNER_ID) toast.dismiss(id);
      }

      if (progress_toast_state !== null) {
        schedule_progress_toast_dismiss(progress_toast_state.owner_token);
      }
    } else if (progress_toast_state?.owner_token === toast_id) {
      schedule_progress_toast_dismiss(toast_id);
    } else {
      toast.dismiss(toast_id);
    }
  }, []);

  /** 任务结束或超时后统一释放模态进度遮罩。 */
  const run_modal_progress_toast = useCallback(
    async <T,>(args: {
      message: string;
      task: () => Promise<T>;
      timeout_ms?: number;
    }): Promise<T> => {
      const progress_toast_id = push_progress_toast({
        message: args.message,
        presentation: "modal",
      });
      let timeout_id: number | null = null;

      try {
        if (args.timeout_ms === undefined) {
          return await args.task();
        }

        return await Promise.race([
          args.task(),
          new Promise<T>((_resolve, reject) => {
            timeout_id = window.setTimeout(() => {
              reject(new ModalProgressToastTimeoutError());
            }, args.timeout_ms);
          }),
        ]);
      } finally {
        if (timeout_id !== null) {
          window.clearTimeout(timeout_id);
        }
        dismiss_toast(progress_toast_id);
      }
    },
    [dismiss_toast, push_progress_toast],
  );

  // 原因：页面里的 useEffect / useCallback 会把 toast API 放进依赖数组，
  // 如果这里每次渲染都返回新函数，就会把“首次刷新”误变成持续重跑
  return useMemo<DesktopToastApi>(() => {
    return {
      push_toast,
      push_progress_toast,
      update_progress_toast,
      dismiss_toast,
      run_modal_progress_toast,
    };
  }, [
    dismiss_toast,
    push_progress_toast,
    push_toast,
    run_modal_progress_toast,
    update_progress_toast,
  ]);
}
