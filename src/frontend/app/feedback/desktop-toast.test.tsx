import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DesktopProgressToastModalLayer,
  ModalProgressToastTimeoutError,
  useDesktopToast,
} from "@frontend/app/feedback/desktop-toast";

const sonner_mock = vi.hoisted(() => {
  const toast = Object.assign(
    vi.fn(() => "progress-toast-id"),
    {
      success: vi.fn(() => "success-toast-id"),
      info: vi.fn(() => "info-toast-id"),
      warning: vi.fn(() => "warning-toast-id"),
      error: vi.fn(() => "error-toast-id"),
      dismiss: vi.fn(),
    },
  );
  return { toast };
});

vi.mock("sonner", () => sonner_mock);
vi.mock("@frontend/widgets/progress-toast-ring/progress-toast-ring", () => ({
  ProgressToastRing: () => null,
}));

type DesktopToastApi = ReturnType<typeof useDesktopToast>;

function ToastProbe(props: { on_ready: (api: DesktopToastApi) => void }): JSX.Element {
  const toast_api = useDesktopToast();

  useEffect(() => {
    props.on_ready(toast_api);
  }, [props, toast_api]);

  return <DesktopProgressToastModalLayer />;
}

describe("useDesktopToast", () => {
  let container: HTMLDivElement;
  let root: Root;
  let toast_api: DesktopToastApi | null;

  beforeEach(async () => {
    vi.useFakeTimers();
    toast_api = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<ToastProbe on_ready={(api) => (toast_api = api)} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function read_toast_api(): DesktopToastApi {
    if (toast_api === null) {
      throw new Error("toast API 尚未初始化");
    }
    return toast_api;
  }

  it("普通和常驻通知按 kind 分派，并固定常驻选项", () => {
    read_toast_api().push_toast("info", "普通通知");
    read_toast_api().push_persistent_toast("warning", "常驻通知");

    expect(sonner_mock.toast.info).toHaveBeenCalledWith("普通通知");
    expect(sonner_mock.toast.warning).toHaveBeenCalledWith("常驻通知", {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    });
  });

  it("只允许当前进度通知 owner 更新和关闭", async () => {
    let first_id: string | number;
    let current_id: string | number;
    await act(async () => {
      first_id = read_toast_api().push_progress_toast({
        message: "第一项",
        progress_percent: 10,
      });
      current_id = read_toast_api().push_progress_toast({
        message: "第二项",
        progress_percent: 20,
      });
    });

    read_toast_api().update_progress_toast(first_id!, {
      message: "过期更新",
      progress_percent: 80,
    });
    expect(sonner_mock.toast).not.toHaveBeenCalledWith("过期更新", expect.anything());

    await act(async () => {
      read_toast_api().update_progress_toast(current_id!, {
        message: "当前更新",
        progress_percent: 80,
      });
      read_toast_api().dismiss_toast(current_id!);
    });
    expect(sonner_mock.toast).toHaveBeenCalledWith(
      "当前更新",
      expect.objectContaining({ id: "desktop-progress-toast" }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(sonner_mock.toast.dismiss).toHaveBeenCalledWith("desktop-progress-toast");
  });

  it("模态任务超时后抛出稳定错误并解除遮罩", async () => {
    let pending_task: Promise<never>;
    await act(async () => {
      pending_task = read_toast_api().run_modal_progress_toast({
        message: "处理中",
        task: () => new Promise<never>(() => undefined),
        timeout_ms: 100,
      });
    });

    expect(container.querySelector(".cn-progress-toast-modal-layer")).not.toBeNull();

    const rejection = expect(pending_task!).rejects.toBeInstanceOf(ModalProgressToastTimeoutError);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    await rejection;
    expect(container.querySelector(".cn-progress-toast-modal-layer")).toBeNull();
    expect(sonner_mock.toast.dismiss).toHaveBeenCalledWith("desktop-progress-toast");
  });
});
