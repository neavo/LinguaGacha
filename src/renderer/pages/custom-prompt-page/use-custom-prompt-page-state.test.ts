import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop/desktop-api";
import type { SettingsSnapshotPayload } from "@/app/desktop/desktop-runtime-context";
import { useCustomPromptPageState } from "@/pages/custom-prompt-page/use-custom-prompt-page-state";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import type { ProjectStoreState } from "@/project/store/project-store";

// RuntimeFixture 固定 useDesktopRuntime 对自定义提示词页暴露的状态和写入口。
type RuntimeFixture = {
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    subscribe: (listener: () => void) => () => void;
    getState: () => ProjectStoreState;
  };
  settings_snapshot: {
    app_language: string;
    translation_custom_prompt_default_preset: string;
    analysis_custom_prompt_default_preset: string;
  };
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_project_mutation: ReturnType<typeof vi.fn>;
  task_snapshot: {
    busy: boolean;
    status: string;
  };
};

// ToastFixture 只保留页面反馈出口，断言 hook 不绕过 toast runtime。
type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
};

// runtime_fixture 作为 hook 的可替换宿主，允许每个用例单独切换项目和任务状态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

// toast_fixture 记录页面反馈，不让测试依赖真实 UI 运行时。
const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

// translate 固定返回 key，避免文案资源变化影响状态流断言。
const translate = (key: string): string => key;

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => toast_fixture.current,
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: translate,
      };
    },
  };
});

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

// ProjectStore 快照只保留自定义提示词页读取的 section，降低 fixture 噪音。
function create_project_store_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/project.lg",
      loaded: true,
    },
    files: {},
    items: createProjectItemIndex(),
    quality: {
      glossary: { entries: [], enabled: false, mode: "append", revision: 0 },
      pre_replacement: { entries: [], enabled: false, mode: "append", revision: 0 },
      post_replacement: { entries: [], enabled: false, mode: "append", revision: 0 },
      text_preserve: { entries: [], enabled: false, mode: "append", revision: 0 },
    },
    prompts: {
      translation: {
        text: "  项目提示词  ",
        enabled: true,
        revision: 3,
      },
      analysis: {
        text: "",
        enabled: false,
        revision: 0,
      },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    revisions: {
      projectRevision: 7,
      sections: {
        prompts: 3,
      },
    },
  };
}

// runtime fixture 模拟 DesktopRuntimeProvider 对页面暴露的最小稳定契约。
function create_runtime_fixture(): RuntimeFixture {
  const state = create_project_store_state();
  return {
    project_snapshot: {
      loaded: true,
      path: "E:/demo/project.lg",
    },
    project_store: {
      subscribe: vi.fn(() => {
        return () => {};
      }),
      getState: () => state,
    },
    settings_snapshot: {
      app_language: "ZH",
      translation_custom_prompt_default_preset: "builtin/default.txt",
      analysis_custom_prompt_default_preset: "",
    },
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => payload),
    commit_project_mutation: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      return {
        payload: await run(),
        mutation_result: {
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
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // render_hook 复用同一个 root，贴近页面生命周期中的重复渲染方式。
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

  it("项目已加载时拉取模板，并用 ProjectStore 提示词覆盖编辑器默认文本", async () => {
    vi.mocked(api_fetch).mockResolvedValue({
      template: {
        default_text: "默认提示词",
        prefix_text: "前缀",
        suffix_text: "后缀",
      },
    });

    await render_hook();

    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/template", {
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

  it("保存提示词通过统一 mutation 管线提交 prompts revision", async () => {
    vi.mocked(api_fetch).mockImplementation(async (path, body = {}) => {
      if (path === "/api/quality/prompts/template") {
        return {
          template: {
            default_text: "默认提示词",
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

    expect(runtime_fixture.current.commit_project_mutation).toHaveBeenCalledWith(
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

  it("任务锁定时忽略编辑和保存，不提交后端 mutation", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        status: "running",
      },
    };
    vi.mocked(api_fetch).mockResolvedValue({
      template: {
        default_text: "默认提示词",
      },
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
    expect(runtime_fixture.current.commit_project_mutation).not.toHaveBeenCalled();
  });
});
