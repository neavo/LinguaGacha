import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectItemPublicRecord } from "@base/item";

import { useTsConversionPageState } from "@/pages/ts-conversion-page/use-ts-conversion-page-state";
import { createProjectItemIndex, type ProjectItemIndex } from "@/project/project-item-index";

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

// 测试只需要模拟 hook 会消费的后端 query 切片，避免把完整运行态搬进页面测试
type RuntimeState = {
  items: ProjectItemIndex;
  quality: {
    text_preserve: {
      entries: Array<Record<string, unknown>>;
      mode: string;
    };
  };
};

let runtime_state: RuntimeState; // runtime_state 每个用例重建，保证 hook 通过 useSyncExternalStore 读到隔离快照
const project_store_listeners = new Set<() => void>();

// 项目数据替身只暴露订阅和读取能力，符合页面 hook 的真实依赖边界
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

vi.mock("@/project/query/ts-conversion-query", () => {
  return {
    read_ts_conversion_query: vi.fn(async () => ({
      projectPath: "E:/demo/sample.lg",
      items: [...runtime_state.items.values()],
      textPreserve: runtime_state.quality.text_preserve,
    })),
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
      project_change_signal: {
        seq: 0,
        reason: "test",
        updated_sections: [],
        results: [],
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

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_runtime_items(
  overrides: Record<string, Partial<ProjectItemPublicRecord>> = {},
): ProjectItemIndex {
  return createProjectItemIndex({
    "1": create_test_item({
      item_id: 1,
      dst: "后台[code]台后",
      name_dst: "台后",
      text_type: "RENPY",
    }),
    "2": create_test_item({
      item_id: 2,
      dst: "后台",
      name_dst: null,
      text_type: "NONE",
    }),
    ...Object.fromEntries(
      Object.entries(overrides).map(([item_id, item]) => {
        return [item_id, create_test_item({ item_id: Number(item_id), ...item })];
      }),
    ),
  });
}

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
      items: create_runtime_items(),
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
    await act(async () => {
      await Promise.resolve();
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

  it("重复 text_type 只读取一次预设并继续导出全部条目", async () => {
    runtime_state = {
      ...runtime_state,
      items: create_runtime_items({
        "3": {
          item_id: 3,
          dst: "后台[code]台后",
          name_dst: null,
          text_type: "NONE",
        },
      }),
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
