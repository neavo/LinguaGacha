import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useCustomPromptPageState } from "@frontend/pages/custom-prompt-page/use-custom-prompt-page-state";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

type RuntimeFixture = {
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  settings_snapshot: {
    app_language: string;
    translation_custom_prompt_default_preset: string;
  };
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_project_write: ReturnType<typeof vi.fn>;
  runtime_snapshot: { revision: number; owner: "batch_translation" | "agent" | null };
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

const translate = (key: string): string => key;

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
    useRuntimeSnapshot: () => runtime_fixture.current.runtime_snapshot,
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

vi.mock("@frontend/app/desktop/desktop-api", async (import_original) => {
  const actual = await import_original<typeof import("@frontend/app/desktop/desktop-api")>();
  return {
    ...actual,
    api_fetch: vi.fn(),
  };
});

function create_runtime_fixture(): RuntimeFixture {
  let prompts_revision = 3;
  return {
    project_snapshot: {
      loaded: true,
      path: "E:/demo/project.lg",
    },
    settings_snapshot: {
      app_language: "ZH",
      translation_custom_prompt_default_preset: "builtin/default.txt",
    },
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => payload),
    commit_project_write: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      prompts_revision += 1;
      return {
        payload,
        write_result: {
          accepted: true,
          changes: [
            {
              source: "quality_prompt_save",
              projectPath: "E:/demo/project.lg",
              projectRevision: prompts_revision,
              updatedSections: ["prompts"],
              operations: [],
              sectionRevisions: {
                prompts: prompts_revision,
              },
            },
          ],
        },
      };
    }),
    runtime_snapshot: { revision: 0, owner: null },
  };
}

function create_toast_fixture(): ToastFixture {
  return {
    push_toast: vi.fn(),
  };
}

describe("useCustomPromptPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useCustomPromptPageState> | null = null;

  beforeEach(() => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock(),
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
    runtime_fixture.current = create_runtime_fixture();
    toast_fixture.current = create_toast_fixture();
    vi.mocked(api_fetch).mockReset();
  });

  function CustomPromptProbe(): null {
    latest_state = useCustomPromptPageState("translation");
    return null;
  }

  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

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

  function create_prompt_query_payload(
    enabled = true,
    text = "  项目提示词  ",
  ): Record<string, unknown> {
    return {
      prompt: {
        text,
        enabled,
      },
      sectionRevisions: {
        prompts: 3,
      },
    };
  }

  type ImportSource = "file" | "preset";

  type PromptApiOptions = {
    initial_enabled?: boolean;
    imported_text?: string;
    read_failure_source?: ImportSource;
    save_handler?: (
      body: Record<string, unknown>,
      save_index: number,
    ) => Promise<unknown> | unknown;
    user_presets?: Array<{
      name: string;
      virtual_id: string;
      type: "user";
    }>;
  };

  function install_prompt_api(options: PromptApiOptions = {}): void {
    const initial_enabled = options.initial_enabled ?? false;
    const imported_text = options.imported_text ?? "  导入提示词  ";
    let save_index = 0;

    vi.mocked(api_fetch).mockImplementation(async (path, body = {}) => {
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
        return create_prompt_query_payload(initial_enabled) as never;
      }
      if (path === "/api/quality/prompts/import") {
        if (options.read_failure_source === "file") {
          throw new Error("文件读取失败");
        }
        return { text: imported_text } as never;
      }
      if (path === "/api/quality/prompts/presets/read") {
        if (options.read_failure_source === "preset") {
          throw new Error("预设读取失败");
        }
        return { text: imported_text } as never;
      }
      if (path === "/api/quality/prompts/save") {
        save_index += 1;
        return (await options.save_handler?.(body as Record<string, unknown>, save_index)) as never;
      }
      if (path === "/api/quality/prompts/presets") {
        return {
          builtin_presets: [],
          user_presets: options.user_presets ?? [],
        } as never;
      }
      if (
        path === "/api/quality/prompts/presets/save" ||
        path === "/api/quality/prompts/presets/delete"
      ) {
        return {} as never;
      }
      throw new Error(`unexpected path: ${path}`);
    });
  }

  function get_save_payloads(): Record<string, unknown>[] {
    return vi
      .mocked(api_fetch)
      .mock.calls.filter(([path]) => path === "/api/quality/prompts/save")
      .map(([, body]) => body as Record<string, unknown>);
  }

  async function trigger_import(source: ImportSource): Promise<void> {
    if (source === "file") {
      Object.defineProperty(window, "desktopApp", {
        configurable: true,
        value: create_desktop_bridge_api_mock({
          methods: {
            pickPromptImportFilePath: async () => ({
              canceled: false,
              paths: ["E:/demo/import.txt"],
            }),
          },
        }),
      });
      await act(async () => {
        await latest_state?.import_prompt_from_picker();
      });
      return;
    }

    await act(async () => {
      latest_state?.set_preset_menu_open(true);
    });
    await act(async () => {
      await latest_state?.apply_preset("builtin:demo.txt");
    });
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

    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/template", {});
    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/view", {});
    expect(latest_state?.template).toEqual({
      default_text: "默认提示词",
      prefix_text: "前缀",
      suffix_text: "后缀",
    });
    expect(latest_state?.prompt_text).toBe("项目提示词");
    expect(latest_state?.enabled).toBe(true);
  });

  it.each(["file", "preset"] as const)(
    "%s 导入前已启用时只保存一次且不打开确认框",
    async (source) => {
      install_prompt_api({ initial_enabled: true });
      await render_hook();

      await trigger_import(source);

      expect(get_save_payloads()).toEqual([
        expect.objectContaining({
          text: "导入提示词",
          enabled: true,
        }),
      ]);
      expect(latest_state?.confirm_state).toEqual({ kind: null });
      expect(latest_state?.prompt_text).toBe("导入提示词");
      expect(latest_state?.enabled).toBe(true);
      if (source === "preset") {
        expect(latest_state?.preset_menu_open).toBe(false);
      }
    },
  );

  it.each(["file", "preset"] as const)("%s 导入前未启用时保持禁用且不打开确认", async (source) => {
    install_prompt_api();
    await render_hook();

    await trigger_import(source);

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        text: "导入提示词",
        enabled: false,
      }),
    ]);
    expect(latest_state?.confirm_state).toEqual({ kind: null });
    expect(latest_state?.prompt_text).toBe("导入提示词");
    expect(latest_state?.enabled).toBe(false);
    if (source === "preset") {
      expect(latest_state?.preset_menu_open).toBe(false);
    }
  });

  it.each(["file", "preset"] as const)("%s 读取失败时不保存", async (source) => {
    install_prompt_api({ read_failure_source: source });
    await render_hook();

    await trigger_import(source);

    expect(get_save_payloads()).toHaveLength(0);
    expect(latest_state?.confirm_state).toEqual({ kind: null });
    expect(latest_state?.prompt_text).toBe("项目提示词");
    expect(latest_state?.enabled).toBe(false);
    if (source === "preset") {
      expect(latest_state?.preset_menu_open).toBe(true);
    }
  });

  it.each(["file", "preset"] as const)("%s 保存失败时保留原状态", async (source) => {
    install_prompt_api({
      save_handler: () => {
        throw new Error("保存失败");
      },
    });
    await render_hook();

    await trigger_import(source);

    expect(get_save_payloads()).toHaveLength(1);
    expect(latest_state?.confirm_state).toEqual({ kind: null });
    expect(latest_state?.prompt_text).toBe("项目提示词");
    expect(latest_state?.enabled).toBe(false);
    if (source === "preset") {
      expect(latest_state?.preset_menu_open).toBe(true);
    }
  });

  it("导出前保存失败时不导出旧正文", async () => {
    install_prompt_api({
      save_handler: () => {
        throw new Error("保存失败");
      },
    });
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          pickPromptExportFilePath: async () => ({
            canceled: false,
            paths: ["E:/demo/export.txt"],
          }),
        },
      }),
    });
    await render_hook();
    await act(async () => {
      latest_state?.update_prompt_text("尚未保存的新正文");
    });

    await act(async () => {
      await latest_state?.export_prompt_from_picker();
    });

    expect(get_save_payloads()).toHaveLength(1);
    expect(api_fetch).not.toHaveBeenCalledWith("/api/quality/prompts/export", expect.anything());
  });

  it("重置确认保留当前启用态并在成功后关闭预设菜单", async () => {
    install_prompt_api({ initial_enabled: true });
    await render_hook();
    await act(async () => {
      latest_state?.set_preset_menu_open(true);
      latest_state?.request_reset_prompt();
    });

    expect(latest_state?.confirm_state).toEqual({
      kind: "reset",
      submitting: false,
    });

    await act(async () => {
      await latest_state?.confirm_pending_action();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        text: "默认提示词",
        enabled: true,
      }),
    ]);
    expect(latest_state?.confirm_state).toEqual({ kind: null });
    expect(latest_state?.preset_menu_open).toBe(false);
  });

  it("删除预设确认只携带目标 id 并在成功后关闭", async () => {
    const preset = {
      name: "待删除",
      virtual_id: "user:待删除.txt",
      type: "user" as const,
    };
    install_prompt_api({ user_presets: [preset] });
    await render_hook();
    await act(async () => {
      await latest_state?.open_preset_menu();
    });
    await act(async () => {
      latest_state?.request_delete_preset(preset);
    });

    expect(latest_state?.confirm_state).toEqual({
      kind: "delete-preset",
      target_virtual_id: "user:待删除.txt",
      submitting: false,
    });

    await act(async () => {
      await latest_state?.confirm_pending_action();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/presets/delete", {
      virtual_id: "user:待删除.txt",
    });
    expect(latest_state?.confirm_state).toEqual({ kind: null });
  });

  it("覆盖预设确认成功后关闭确认框和预设输入框", async () => {
    install_prompt_api({
      user_presets: [
        {
          name: "重复",
          virtual_id: "user:重复.txt",
          type: "user",
        },
      ],
    });
    await render_hook();
    await act(async () => {
      await latest_state?.open_preset_menu();
      latest_state?.request_save_preset();
    });
    await act(async () => {
      latest_state?.update_preset_input_value("重复");
    });
    await act(async () => {
      await latest_state?.submit_preset_input();
    });

    expect(latest_state?.confirm_state).toEqual({
      kind: "overwrite-preset",
      preset_input_value: "重复",
      submitting: false,
    });

    await act(async () => {
      await latest_state?.confirm_pending_action();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/quality/prompts/presets/save", {
      name: "重复",
      text: "项目提示词",
    });
    expect(latest_state?.confirm_state).toEqual({ kind: null });
    expect(latest_state?.preset_input_state.open).toBe(false);
  });
});
