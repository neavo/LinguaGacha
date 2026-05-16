import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTsConversionPageState } from "@/pages/ts-conversion-page/use-ts-conversion-page-state";

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

// 测试只需要模拟 hook 会消费的 ProjectStore 切片，避免把完整运行态搬进页面测试
type RuntimeState = {
  items: Record<string, Record<string, unknown>>;
  quality: {
    text_preserve: {
      entries: Array<Record<string, unknown>>;
      mode: string;
    };
  };
};

let runtime_state: RuntimeState; // runtime_state 每个用例重建，保证 hook 通过 useSyncExternalStore 读到隔离快照
const project_store_listeners = new Set<() => void>();

// ProjectStore 替身只暴露订阅和读取能力，符合页面 hook 的真实依赖边界
const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => runtime_state,
};

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
      project_store,
    }),
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      push_progress_toast: push_progress_toast_mock,
      update_progress_toast: update_progress_toast_mock,
      dismiss_toast: dismiss_toast_mock,
    }),
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

// 探针组件把 hook 的公开状态交给测试，避免测试依赖 React 内部实现
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
    project_store_listeners.clear();
    runtime_state = {
      items: {
        "1": {
          item_id: 1,
          dst: "后台[code]台后",
          name_dst: "台后",
          text_type: "RENPY",
        },
        "2": {
          item_id: 2,
          dst: "后台",
          name_dst: null,
          text_type: "NONE",
        },
      },
      quality: {
        text_preserve: {
          entries: [],
          mode: "smart",
        },
      },
    };
    push_progress_toast_mock.mockReturnValue("ts-conversion-progress");
    // 默认 API mock 覆盖成功路径：先读每个内置预设，再导出转换结果
    api_fetch_mock.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === "/api/quality/rules/presets/read") {
        if (body.virtual_id === "builtin:renpy.json") {
          return {
            entries: [{ src: "\\[[^\\]]+\\]" }, { src: "  " }, { info: "缺少 src" }],
          };
        }
        return {
          entries: [{ src: "<[^>]+>" }],
        };
      }
      if (path === "/api/project/export-converted-translation") {
        return {
          accepted: true,
          output_path: "E:/demo/sample_S2T.txt",
        };
      }
      throw new Error(`未预期的 API 路径：${path}`);
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

  // 每个用例单独挂载 hook 探针，确保状态初始化和卸载副作用完整执行
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
  }

  it("smart 模式通过质量规则预设读取内置文本保护规则", async () => {
    await mount_probe();
    if (latest_state === null) {
      throw new Error("简繁转换页面状态未准备就绪。");
    }

    await act(async () => {
      await latest_state!.confirm_conversion();
    });

    expect(api_fetch_mock.mock.calls.some(([path]) => String(path).endsWith("preset-rules"))).toBe(
      false,
    );
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/presets/read", {
      rule_type: "text_preserve",
      virtual_id: "builtin:renpy.json",
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/presets/read", {
      rule_type: "text_preserve",
      virtual_id: "builtin:none.json",
    });
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/project/export-converted-translation",
      expect.objectContaining({
        suffix: "_S2T",
        items: [
          {
            item_id: 1,
            dst: "後臺[code]臺後",
            name_dst: "臺後",
          },
          {
            item_id: 2,
            dst: "後臺",
            name_dst: null,
          },
        ],
      }),
    );
  });

  it("挂载时提示优先使用原生繁中目标语言", async () => {
    await mount_probe();

    expect(push_toast_mock).toHaveBeenCalledWith(
      "info",
      "ts_conversion_page.feedback.prefer_native_traditional_chinese",
    );
  });

  it("单个内置预设读取失败时按空规则继续导出", async () => {
    api_fetch_mock.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === "/api/quality/rules/presets/read") {
        if (body.virtual_id === "builtin:renpy.json") {
          throw new Error("预设不存在");
        }
        return {
          entries: "坏数据",
        };
      }
      if (path === "/api/project/export-converted-translation") {
        return {
          accepted: true,
          output_path: "E:/demo/sample_S2T.txt",
        };
      }
      throw new Error(`未预期的 API 路径：${path}`);
    });

    await mount_probe();
    if (latest_state === null) {
      throw new Error("简繁转换页面状态未准备就绪。");
    }

    await act(async () => {
      await latest_state!.confirm_conversion();
    });

    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/project/export-converted-translation",
      expect.objectContaining({
        items: [
          {
            item_id: 1,
            dst: "後臺[code]臺後",
            name_dst: "臺後",
          },
          {
            item_id: 2,
            dst: "後臺",
            name_dst: null,
          },
        ],
      }),
    );
    expect(push_toast_mock).not.toHaveBeenCalledWith("error", expect.anything());
  });

  it("未知 text_type 沿用旧路由语义跳过预设读取并继续导出", async () => {
    runtime_state.items["3"] = {
      item_id: 3,
      dst: "后台[code]台后",
      name_dst: null,
      text_type: "../secret",
    };

    await mount_probe();
    if (latest_state === null) {
      throw new Error("简繁转换页面状态未准备就绪。");
    }

    await act(async () => {
      await latest_state!.confirm_conversion();
    });

    const preset_calls = api_fetch_mock.mock.calls.filter(
      ([path]) => path === "/api/quality/rules/presets/read",
    );
    expect(preset_calls).toEqual([
      [
        "/api/quality/rules/presets/read",
        {
          rule_type: "text_preserve",
          virtual_id: "builtin:renpy.json",
        },
      ],
      [
        "/api/quality/rules/presets/read",
        {
          rule_type: "text_preserve",
          virtual_id: "builtin:none.json",
        },
      ],
    ]);
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/project/export-converted-translation",
      expect.objectContaining({
        items: expect.arrayContaining([
          {
            item_id: 3,
            dst: "後臺[code]臺後",
            name_dst: null,
          },
        ]),
      }),
    );
  });
});
