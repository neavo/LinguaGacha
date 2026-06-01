import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useCustomPromptPageState } from "@frontend/pages/custom-prompt-page/use-custom-prompt-page-state";

// 固定 useDesktopState 对自定义提示词页暴露的状态和写入口。
type RuntimeFixture = {
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  settings_snapshot: {
    app_language: string;
    translation_custom_prompt_default_preset: string;
    analysis_custom_prompt_default_preset: string;
  };
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_project_write: ReturnType<typeof vi.fn>;
  task_snapshot: {
    busy: boolean;
    status: string;
  };
};

// 只保留页面反馈出口，断言 hook 不绕过 toast feedback。
type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
};

// 作为 hook 的可替换宿主，允许每个用例单独切换项目和任务状态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

// 记录页面反馈，不让测试依赖真实 UI 运行时。
const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

// 固定返回 key，避免文案资源变化影响状态流断言。
/**
 * 支撑当前测试场景的专用辅助逻辑。
 */
const translate = (key: string): string => key;

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => toast_fixture.current,
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: translate,
      };
    },
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

// state fixture 模拟 DesktopStateProvider 对页面暴露的最小稳定契约。
/**
 * 构造当前测试场景的标准数据。
 */
function create_runtime_fixture(): RuntimeFixture {
  return {
    project_snapshot: {
      loaded: true,
      path: "E:/demo/project.lg",
    },
    settings_snapshot: {
      app_language: "ZH",
      translation_custom_prompt_default_preset: "builtin/default.txt",
      analysis_custom_prompt_default_preset: "",
    },
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => payload),
    commit_project_write: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      return {
        payload: await run(),
        write_result: {
          accepted: true,
          changes: [],
        },
      };
    }),
    task_snapshot: {
      busy: false,
      status: "idle",
    },
  };
}

// toast fixture 只记录调用参数，错误和成功路径都由 hook 自己收口。
/**
 * 构造当前测试场景的标准数据。
 */
function create_toast_fixture(): ToastFixture {
  return {
    push_toast: vi.fn(),
  };
}

describe("useCustomPromptPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useCustomPromptPageState> | null = null;

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
    runtime_fixture.current = create_runtime_fixture();
    toast_fixture.current = create_toast_fixture();
    vi.mocked(api_fetch).mockReset();
  });

  // Probe 把 hook 返回值提升到测试作用域，不引入额外组件行为。
  function CustomPromptProbe(): null {
    latest_state = useCustomPromptPageState("translation");
    return null;
  }

  // React effect 与异步模板读取连续排队，三次 tick 覆盖当前 hook 的更新链。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // render_hook 复用同一个 root，贴近页面生命周期中的重复渲染方式。
  /**
   * 生成当前场景的展示内容。
   */
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(CustomPromptProbe));
    });
    await flush_async_updates();
  }

  /**
   * 构造当前测试场景的标准数据。
   */
  function create_prompt_query_payload(): Record<string, unknown> {
    return {
      prompt: {
        text: "  项目提示词  ",
        enabled: true,
      },
      sectionRevisions: {
        prompts: 3,
      },
    };
  }

  it("项目已加载时拉取模板，并用后端提示词覆盖编辑器默认文本", async () => {
    vi.mocked(api_fetch).mockImplementation(async (path) => {
      if (path === "/api/quality/prompts/template") {
        return {
          template: {
            default_text: "默认提示词",
            prefix_text: "前缀",
            suffix_text: "后缀",
          },
        } as never;
      }
      if (path === "/api/quality/prompts/view") {
        return create_prompt_query_payload() as never;
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await render_hook();

    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/template", {
      task_type: "translation",
    });
    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/view", {
      task_type: "translation",
    });
    expect(latest_state?.template).toEqual({
      default_text: "默认提示词",
      prefix_text: "前缀",
      suffix_text: "后缀",
    });
    expect(latest_state?.prompt_text).toBe("项目提示词");
    expect(latest_state?.enabled).toBe(true);
  });

  it("保存提示词通过统一写入管线提交 prompts revision", async () => {
    vi.mocked(api_fetch).mockImplementation(async (path, body = {}) => {
      if (path === "/api/quality/prompts/template") {
        return {
          template: {
            default_text: "默认提示词",
          },
        } as never;
      }
      if (path === "/api/quality/prompts/view") {
        return create_prompt_query_payload() as never;
      }
      if (path === "/api/workbench/snapshot") {
        return {
          sectionRevisions: {
            prompts: 3,
          },
        } as never;
      }
      if (path === "/api/quality/prompts/save") {
        return {
          changes: [],
          ...body,
        } as never;
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await render_hook();

    await act(async () => {
      latest_state?.update_prompt_text("  新提示词  ");
    });
    await act(async () => {
      await latest_state?.save_prompt_text();
    });

    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "custom-prompt.prompt_save",
        task_type: "translation",
      }),
    );
    expect(api_fetch).toHaveBeenLastCalledWith("/api/quality/prompts/save", {
      task_type: "translation",
      expected_section_revisions: {
        prompts: 3,
      },
      text: "新提示词",
      enabled: true,
    });
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "success",
      "app.feedback.save_success",
    );
  });

  it("任务锁定时忽略编辑和保存，不提交后端 write", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        status: "running",
      },
    };
    vi.mocked(api_fetch).mockImplementation(async (path) => {
      if (path === "/api/quality/prompts/template") {
        return {
          template: {
            default_text: "默认提示词",
          },
        } as never;
      }
      if (path === "/api/quality/prompts/view") {
        return create_prompt_query_payload() as never;
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await render_hook();

    await act(async () => {
      latest_state?.update_prompt_text("不应写入");
    });
    await act(async () => {
      await latest_state?.save_prompt_text();
    });

    expect(latest_state?.readonly).toBe(true);
    expect(latest_state?.prompt_text).toBe("项目提示词");
    expect(runtime_fixture.current.commit_project_write).not.toHaveBeenCalled();
  });
});
