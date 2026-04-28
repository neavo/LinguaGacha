import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPage } from "@/pages/project-page/page";

const {
  api_fetch_mock,
  barrier_fixture,
  desktop_runtime_fixture,
  dismiss_toast_mock,
  push_progress_toast_mock,
  push_toast_mock,
  update_progress_toast_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    barrier_fixture: {
      current: {
        create_barrier_checkpoint: vi.fn(() => {
          return {
            projectPath: "",
            workbenchLastLoadedAt: null,
            proofreadingLastLoadedAt: null,
          };
        }),
        wait_for_barrier: vi.fn(async () => {}),
      },
    },
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
  "app.action.loading": "加载中",
  "app.action.reset": "重置",
  "app.action.select_file": "选择文件",
  "app.action.select_folder": "选择文件夹",
  "project_page.create.action": "创建工程",
  "project_page.create.default_preset_loaded": "已自动加载默认预设：{NAMES} …",
  "project_page.create.default_presets.analysis_prompt": "分析提示词",
  "project_page.create.default_presets.glossary": "术语表",
  "project_page.create.default_presets.post_translation_replacement": "译后替换",
  "project_page.create.default_presets.pre_translation_replacement": "译前替换",
  "project_page.create.default_presets.text_preserve": "文本保护",
  "project_page.create.default_presets.translation_prompt": "翻译提示词",
  "project_page.create.drop_title": "点击或拖拽源文件",
  "project_page.create.failed": "创建工程失败：{ERROR}",
  "project_page.create.failed_generic": "创建工程失败",
  "project_page.create.loading_toast": "正在创建工程 …",
  "project_page.create.ready_status": "包含 {COUNT} 个源文件，准备就绪",
  "project_page.create.subtitle": "选择源文件创建 .lg 工程文件，创建完成后即不再需要源文件。",
  "project_page.create.title": "新建工程",
  "project_page.formats.title": "支持文件格式",
  "project_page.open.action": "打开工程",
  "project_page.open.drop_title": "点击或拖拽 .lg 文件",
  "project_page.open.empty": "暂无最近打开的工程",
  "project_page.open.recent_title": "最近打开",
  "project_page.open.subtitle": "加载现有的 .lg 工程文件以继承翻译进度、翻译规则继续工作。",
  "project_page.open.title": "打开工程",
};

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => I18N_TEXT_BY_KEY[key] ?? key,
    }),
  };
});

vi.mock("@/app/desktop-api", async () => {
  const actual = await vi.importActual<typeof import("@/app/desktop-api")>("@/app/desktop-api");
  return {
    ...actual,
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => desktop_runtime_fixture.current,
  };
});

vi.mock("@/app/runtime/project-pages/project-pages-context", () => {
  return {
    useProjectPagesBarrier: () => barrier_fixture.current,
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      dismiss_toast: dismiss_toast_mock,
      push_progress_toast: push_progress_toast_mock,
      push_toast: push_toast_mock,
      update_progress_toast: update_progress_toast_mock,
    }),
  };
});

vi.mock("@/widgets/app-context-menu/app-context-menu", () => {
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

vi.mock("@/widgets/app-button/app-button", () => {
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

vi.mock("@/shadcn/card", () => {
  return {
    Card: (props: { children: ReactNode }) => <section>{props.children}</section>,
    CardContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    CardDescription: (props: { children: ReactNode }) => <p>{props.children}</p>,
    CardFooter: (props: { children: ReactNode }) => <footer>{props.children}</footer>,
    CardHeader: (props: { children: ReactNode }) => <header>{props.children}</header>,
    CardTitle: (props: { children: ReactNode }) => <h2>{props.children}</h2>,
  };
});

vi.mock("@/shadcn/progress", () => {
  return {
    Progress: () => <div />,
  };
});

vi.mock("@/shadcn/spinner", () => {
  return {
    Spinner: () => <span />,
  };
});

vi.mock("@/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/widgets/app-alert-dialog/app-alert-dialog", () => {
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
    output_folder_open_on_finish: true,
    request_timeout: 60,
    preceding_lines_threshold: 0,
    clean_ruby: false,
    deduplication_in_trans: true,
    deduplication_in_bilingual: true,
    check_kana_residue: true,
    check_hangeul_residue: true,
    check_similarity: true,
    write_translated_name_fields_to_file: true,
    auto_process_prefix_suffix_preserved_text: true,
    mtool_optimizer_enable: true,
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
    project_warmup_stage: null,
    settings_snapshot: create_settings_snapshot(settings_overrides),
    set_project_snapshot: vi.fn(),
    set_project_warmup_status: vi.fn(),
    refresh_settings: vi.fn(async () => {}),
    refresh_task: vi.fn(async () => {}),
  };
}

function install_desktop_app_fixture(): void {
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    writable: true,
    value: {
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
      if (path === "/api/project/source-files") {
        return { source_files: ["E:\\Source\\demo.txt"] };
      }
      if (path === "/api/project/create") {
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
    barrier_fixture.current.create_barrier_checkpoint.mockClear();
    barrier_fixture.current.wait_for_barrier.mockClear();
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

  it("默认预设字段非空时在新建成功后弹出自动加载提示", async () => {
    desktop_runtime_fixture.current = create_desktop_runtime_fixture({
      glossary_default_preset: "builtin:glossary",
      text_preserve_default_preset: "builtin:text-preserve",
    });
    await mount_page();

    await create_project_from_selected_source();

    expect(push_toast_mock).toHaveBeenCalledWith("info", "已自动加载默认预设：术语表 | 文本保护 …");
  });

  it("默认预设字段全为空时新建成功后不弹自动加载提示", async () => {
    await mount_page();

    await create_project_from_selected_source();

    expect(push_toast_mock).not.toHaveBeenCalledWith(
      "info",
      expect.stringContaining("已自动加载默认预设"),
    );
  });

  it("新建工程失败时不弹默认预设成功提示", async () => {
    desktop_runtime_fixture.current = create_desktop_runtime_fixture({
      glossary_default_preset: "builtin:glossary",
    });
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/project/source-files") {
        return { source_files: ["E:\\Source\\demo.txt"] };
      }
      if (path === "/api/project/create") {
        throw new Error("create boom");
      }

      return {};
    });
    await mount_page();

    await create_project_from_selected_source();

    expect(push_toast_mock).not.toHaveBeenCalledWith(
      "info",
      expect.stringContaining("已自动加载默认预设"),
    );
  });
});
