import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTsConversionPageState } from "@frontend/pages/ts-conversion-page/use-ts-conversion-page-state";

const {
  api_fetch_mock,
  push_toast_mock,
  push_progress_toast_mock,
  update_progress_toast_mock,
  dismiss_toast_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    push_progress_toast_mock: vi.fn(),
    update_progress_toast_mock: vi.fn(),
    dismiss_toast_mock: vi.fn(),
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => ({
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
      project_session_status: "ready",
    }),
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      push_progress_toast: push_progress_toast_mock,
      update_progress_toast: update_progress_toast_mock,
      dismiss_toast: dismiss_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

function Probe(props: {
  on_ready: (state: ReturnType<typeof useTsConversionPageState>) => void;
}): JSX.Element | null {
  const state = useTsConversionPageState();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useTsConversionPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useTsConversionPageState> | null = null;

  beforeEach(() => {
    push_progress_toast_mock.mockReturnValue("ts-conversion-progress");
    api_fetch_mock.mockResolvedValue({
      accepted: true,
      output_path: "E:/demo/sample_S2T.txt",
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    push_progress_toast_mock.mockReset();
    update_progress_toast_mock.mockReset();
    dismiss_toast_mock.mockReset();
  });

  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("确认后只提交转换选项给 Backend 导出接口", async () => {
    await mount_probe();
    if (latest_state === null) {
      throw new Error("简繁转换页面状态未准备就绪。");
    }

    await act(async () => {
      await latest_state!.confirm_conversion();
    });

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/toolbox/ts-conversion/files/export", {
      direction: "s2t",
      convert_name: true,
      preserve_text: true,
    });
    expect(api_fetch_mock).not.toHaveBeenCalledWith(
      "/api/quality/rules/presets/read",
      expect.anything(),
    );
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "ts_conversion_page.feedback.task_success",
    );
  });

  it("挂载时提示优先使用原生繁中目标语言", async () => {
    await mount_probe();

    expect(push_toast_mock).toHaveBeenCalledWith(
      "info",
      "ts_conversion_page.feedback.prefer_native_traditional_chinese",
    );
  });
});
