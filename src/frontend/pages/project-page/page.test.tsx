import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPage } from "@frontend/pages/project-page/page";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const {
  api_fetch_mock,
  desktop_runtime_fixture,
  dismiss_toast_mock,
  push_progress_toast_mock,
  push_toast_mock,
  update_progress_toast_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    desktop_runtime_fixture: {
      current: null as ReturnType<typeof create_desktop_runtime_fixture> | null,
    },
    dismiss_toast_mock: vi.fn(),
    push_progress_toast_mock: vi.fn(() => "project-loading-toast"),
    push_toast_mock: vi.fn(),
    update_progress_toast_mock: vi.fn(),
  };
});

const I18N_TEXT_BY_KEY: Record<string, string> = {
  "app.action.select_file": "选择文件",
  "project_page.create.action": "创建工程",
  "project_page.create.ready_status": "已选择 {COUNT} 个源文件",
};

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string, params: Record<string, string> = {}) => {
        const template = I18N_TEXT_BY_KEY[key] ?? key;
        return Object.entries(params).reduce((text, [name, value]) => {
          return text.replaceAll(`{${name}}`, value);
        }, template);
      },
    }),
  };
});

vi.mock("@frontend/app/desktop/desktop-api", async () => {
  const actual = await vi.importActual<typeof import("@frontend/app/desktop/desktop-api")>(
    "@frontend/app/desktop/desktop-api",
  );
  return {
    ...actual,
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => desktop_runtime_fixture.current,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      dismiss_toast: dismiss_toast_mock,
      push_progress_toast: push_progress_toast_mock,
      push_toast: push_toast_mock,
      update_progress_toast: update_progress_toast_mock,
    }),
  };
});

vi.mock("@frontend/widgets/app-context-menu", () => {
  return {
    AppContextMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppContextMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppContextMenuItem: (props: { children: ReactNode; onSelect?: (event: Event) => void }) => (
      <button
        type="button"
        onClick={() => {
          props.onSelect?.(new Event("select"));
        }}
      >
        {props.children}
      </button>
    ),
    AppContextMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/widgets/app-button", () => {
  return {
    AppButton: (props: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      type?: "button";
      "aria-label"?: string;
    }) => (
      <button
        type={props.type ?? "button"}
        aria-label={props["aria-label"]}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    ),
  };
});

vi.mock("@frontend/shadcn/card", () => {
  return {
    Card: (props: { children: ReactNode }) => <section>{props.children}</section>,
    CardContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    CardDescription: (props: { children: ReactNode }) => <p>{props.children}</p>,
    CardFooter: (props: { children: ReactNode }) => <footer>{props.children}</footer>,
    CardHeader: (props: { children: ReactNode }) => <header>{props.children}</header>,
    CardTitle: (props: { children: ReactNode }) => <h2>{props.children}</h2>,
  };
});

vi.mock("@frontend/shadcn/spinner", () => {
  return {
    Spinner: () => <span />,
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/widgets/app-alert-dialog", () => {
  return {
    AppAlertDialog: () => null,
  };
});

function create_settings_snapshot(overrides: Record<string, unknown> = {}) {
  return {
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    project_save_mode: "SOURCE",
    project_fixed_path: "",
    output_folder_open_on_finish: false,
    request_timeout: 120,
    preceding_lines_threshold: 0,
    clean_ruby: false,
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
    auto_process_prefix_suffix_preserved_text: true,
    mtool_optimizer_enable: true,
    skip_duplicate_source_text_enable: true,
    glossary_default_preset: "",
    pre_translation_replacement_default_preset: "",
    post_translation_replacement_default_preset: "",
    text_preserve_default_preset: "",
    translation_custom_prompt_default_preset: "",
    analysis_custom_prompt_default_preset: "",
    recent_projects: [],
    ...overrides,
  };
}

function create_desktop_runtime_fixture(settings_overrides: Record<string, unknown> = {}) {
  return {
    project_session_stage: null,
    settings_snapshot: create_settings_snapshot(settings_overrides),
    refresh_project_snapshot: vi.fn(),
    set_project_session_status: vi.fn(),
    refresh_settings: vi.fn(async () => {}),
    refresh_task: vi.fn(async () => {}),
  };
}

function install_desktop_app_fixture(): void {
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    writable: true,
    value: create_desktop_bridge_api_mock({
      methods: {
        getPathForFile: vi.fn(() => ""),
        pickFixedProjectDirectory: vi.fn(async () => ({ canceled: true, paths: [] })),
        pickProjectFilePath: vi.fn(async () => ({ canceled: true, paths: [] })),
        pickProjectSavePath: vi.fn(async () => ({ canceled: true, paths: [] })),
        pickProjectSourceDirectoryPath: vi.fn(async () => ({ canceled: true, paths: [] })),
        pickProjectSourceFilePath: vi.fn(async () => ({
          canceled: false,
          paths: ["E:\\Source\\demo.txt"],
        })),
      },
    }),
  });
}

async function flush_async_updates(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function get_button_by_text(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((element) => {
    return element.textContent?.includes(text) ?? false;
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`未找到按钮：${text}`);
  }

  return button;
}

describe("ProjectPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    desktop_runtime_fixture.current = create_desktop_runtime_fixture();
    install_desktop_app_fixture();
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    };
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/session/source-files/collect") {
        return { source_files: ["E:\\Source\\demo.txt"] };
      }
      if (path === "/api/session/project/create") {
        return { project: { path: "E:\\Source\\demo_20260428_120000.lg", loaded: true } };
      }
      if (path === "/api/settings/recent-projects/add") {
        return { settings: { recent_projects: [] } };
      }

      return {};
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
    api_fetch_mock.mockReset();
    dismiss_toast_mock.mockReset();
    push_progress_toast_mock.mockClear();
    push_toast_mock.mockReset();
    update_progress_toast_mock.mockReset();
  });

  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ProjectPage is_sidebar_collapsed={false} />);
    });
  }

  async function create_project_from_selected_source(): Promise<void> {
    if (container === null) {
      throw new Error("项目页尚未挂载。");
    }
    const page_container = container;

    await act(async () => {
      get_button_by_text(page_container, "选择文件").click();
      await flush_async_updates();
    });

    await act(async () => {
      get_button_by_text(page_container, "创建工程").click();
      await flush_async_updates();
    });
  }

  it("新建工程默认提交 stem.lg，并用后端真实路径写入最近工程", async () => {
    await mount_page();

    await create_project_from_selected_source();

    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({
        path: "E:\\Source\\demo.lg",
      }),
    );
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/settings/recent-projects/add", {
      path: "E:\\Source\\demo_20260428_120000.lg",
      name: "demo_20260428_120000",
    });
  });

  it("多选源文件后使用完整 source_paths 创建工程", async () => {
    const selected_paths = ["E:\\Source\\a.txt", "E:\\Source\\b.md"];
    vi.mocked(window.desktopApp.pickProjectSourceFilePath).mockResolvedValueOnce({
      canceled: false,
      paths: [...selected_paths, "E:\\Source\\a.txt", " "],
    });
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/session/source-files/collect") {
        return { source_files: selected_paths };
      }
      if (path === "/api/session/project/create") {
        return { project: { path: "E:\\Source\\a_20260428_120000.lg", loaded: true } };
      }
      if (path === "/api/settings/recent-projects/add") {
        return { settings: { recent_projects: [] } };
      }

      return {};
    });
    await mount_page();

    await act(async () => {
      get_button_by_text(container as HTMLElement, "选择文件").click();
      await flush_async_updates();
    });

    expect(container?.textContent).toContain("已选择 2 个源文件");

    await act(async () => {
      get_button_by_text(container as HTMLElement, "创建工程").click();
      await flush_async_updates();
    });

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/source-files/collect", {
      source_paths: selected_paths,
    });
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({
        path: "E:\\Source\\a.lg",
        source_paths: selected_paths,
        project_settings: {
          source_language: "JA",
          target_language: "ZH",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
      }),
    );
    expect(api_fetch_mock).not.toHaveBeenCalledWith(
      "/api/session/project/create-preview",
      expect.anything(),
    );
  });
});
