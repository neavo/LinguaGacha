import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCustomPromptPageState } from "./use-custom-prompt-page-state";

const { api_fetch_mock, desktop_state, i18n_value, push_toast_mock } = vi.hoisted(() => {
  const push_toast = vi.fn();
  return {
    api_fetch_mock: vi.fn(),
    desktop_state: {
      project_snapshot: {
        path: "E:/demo/sample.lg",
        loaded: true,
      },
      settings_snapshot: {
        app_language: "ZH",
      },
      apply_settings_snapshot: vi.fn(),
      commit_project_write: vi.fn(async (request) => {
        return await request.run();
      }),
      task_snapshot: {
        task_type: null,
        status: "idle",
        busy: false,
        progress: {},
        extras: { kind: "analysis", candidate_count: 0 },
      },
    },
    i18n_value: {
      t: (key: string, params?: Record<string, string>) => {
        return params?.TITLE === undefined ? key : `${key}:${params.TITLE}`;
      },
    },
    push_toast_mock: push_toast,
  };
});

let save_should_fail = false;

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@frontend/pages/custom-prompt-page/custom-prompt-api-client", () => {
  return {
    read_custom_prompt_section_revisions: vi.fn(async () => ({
      prompts: 1,
    })),
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => desktop_state,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => i18n_value,
  };
});

function Probe(props: {
  on_ready: (state: ReturnType<typeof useCustomPromptPageState>) => void;
}): JSX.Element | null {
  const state = useCustomPromptPageState("translation");

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useCustomPromptPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useCustomPromptPageState> | null = null;

  beforeEach(() => {
    save_should_fail = false;
    push_toast_mock.mockReset();
    api_fetch_mock.mockReset();
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/quality/prompts/template") {
        return {
          template: {
            default_text: "默认提示词",
            prefix_text: "固定前缀",
            suffix_text: "固定后缀",
          },
        };
      }
      if (path === "/api/quality/prompts/view") {
        return {
          prompt: {
            text: "当前提示词",
            enabled: false,
          },
        };
      }
      if (path === "/api/quality/prompts/save") {
        if (save_should_fail) {
          throw new Error("保存失败");
        }
        return {
          accepted: true,
          changes: [],
        };
      }
      throw new Error(`未处理的测试请求：${path}`);
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

  it("启用和禁用成功后显示对应状态提醒", async () => {
    await mount_probe();

    await act(async () => {
      await latest_state?.update_enabled(true);
    });
    expect(latest_state?.enabled).toBe(true);
    expect(push_toast_mock).toHaveBeenLastCalledWith(
      "success",
      "app.feedback.feature_enabled:translation_prompt_page.header.title",
    );

    await act(async () => {
      await latest_state?.update_enabled(false);
    });
    expect(latest_state?.enabled).toBe(false);
    expect(push_toast_mock).toHaveBeenLastCalledWith(
      "success",
      "app.feedback.feature_disabled:translation_prompt_page.header.title",
    );
  });

  it("开关写入失败时不显示成功提醒", async () => {
    await mount_probe();
    save_should_fail = true;

    await act(async () => {
      await latest_state?.update_enabled(true);
    });

    expect(latest_state?.enabled).toBe(false);
    expect(push_toast_mock).not.toHaveBeenCalledWith("success", expect.anything());
  });
});
