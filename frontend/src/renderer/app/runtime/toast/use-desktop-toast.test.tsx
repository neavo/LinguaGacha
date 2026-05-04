import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";

const sonner_mock = vi.hoisted(() => {
  const toast = vi.fn(() => "progress-toast-id") as unknown as {
    (message: string, options?: unknown): string;
    success: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };
  toast.success = vi.fn(() => "success-toast-id");
  toast.info = vi.fn(() => "info-toast-id");
  toast.warning = vi.fn(() => "warning-toast-id");
  toast.error = vi.fn(() => "error-toast-id");
  toast.dismiss = vi.fn();
  return { toast };
});

vi.mock("sonner", () => {
  return {
    toast: sonner_mock.toast,
  };
});

vi.mock("@/widgets/progress-toast-ring/progress-toast-ring", () => {
  return {
    ProgressToastRing: () => null,
  };
});

type DesktopToastApi = ReturnType<typeof useDesktopToast>;

type ToastProbeProps = {
  on_ready: (api: DesktopToastApi) => void;
};

function ToastProbe(props: ToastProbeProps): JSX.Element | null {
  const toast_api = useDesktopToast();

  useEffect(() => {
    props.on_ready(toast_api);
  }, [props, toast_api]);

  return null;
}

describe("useDesktopToast", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let toast_api: DesktopToastApi | null = null;

  function read_toast_api(): DesktopToastApi {
    if (toast_api === null) {
      throw new Error("toast_api 尚未初始化。");
    }
    return toast_api;
  }

  async function render_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ToastProbe
          on_ready={(api) => {
            toast_api = api;
          }}
        />,
      );
    });
  }

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    toast_api = null;
    vi.clearAllMocks();
  });

  it("普通通知会保留消息里的显式换行", async () => {
    await render_probe();

    read_toast_api().push_toast("info", "已按当前设置更新项目设置 …\n输入语言 - 日语");

    expect(sonner_mock.toast.info).toHaveBeenCalledWith(
      "已按当前设置更新项目设置 …\n输入语言 - 日语",
    );
  });

  it("常驻通知会保留消息里的显式换行", async () => {
    await render_probe();

    read_toast_api().push_persistent_toast("warning", "第一行\r\n第二行");

    expect(sonner_mock.toast.warning).toHaveBeenCalledWith(
      "第一行\r\n第二行",
      expect.objectContaining({
        closeButton: true,
        duration: Number.POSITIVE_INFINITY,
      }),
    );
  });

  it("进度通知会保留消息里的显式换行", async () => {
    await render_probe();

    read_toast_api().push_progress_toast({
      message: "正在处理\n请稍候",
      progress_percent: 25,
    });

    expect(sonner_mock.toast).toHaveBeenCalledWith(
      "正在处理\n请稍候",
      expect.objectContaining({
        id: "desktop-progress-toast",
      }),
    );
  });
});
