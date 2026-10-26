import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { type ReactNode, act, cloneElement, isValidElement } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { ProjectPage } from "@frontend/pages/project-page/page";
import { PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY } from "./project-language-preference";
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

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  dismiss_toast: dismiss_toast_mock,
  push_progress_toast: push_progress_toast_mock,
  push_error_toast: push_toast_mock,
  push_toast: push_toast_mock,
  update_progress_toast: update_progress_toast_mock,
}));

vi.mock("@frontend/widgets/app-context-menu", () => {
  return {
    AppContextMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppContextMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppContextMenuItem: (props: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: (event: Event) => void;
    }) => (
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => {
          props.onClick?.(new Event("select"));
        }}
      >
        {props.children}
      </button>
    ),
    AppContextMenuTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
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
    Tooltip: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
    TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
    TooltipTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>
        {isValidElement(props.render) && props.children !== undefined
          ? cloneElement(props.render, undefined, props.children)
          : (props.render ?? props.children)}
      </>
    ),
  };
});

// 语言下拉替换为按钮，测试直接表达用户选择的语言。
vi.mock("@frontend/features/project-language/project-language-select", () => {
  return {
    ProjectLanguageSelect: (props: {
      field: string;
      value: string;
      on_change: (next_value: string) => void;
    }) => (
      <span data-field={props.field} data-value={props.value}>
        {["JA", "EN", "KO", "ZH"].map((code) => (
          <button key={code} type="button" onClick={() => props.on_change(code)}>
            {`${props.field}:${code}`}
          </button>
        ))}
      </span>
    ),
  };
});

/** 构造项目页需要的最小设置快照，并允许场景定点覆写。 */
function create_settings_snapshot(overrides: Record<string, unknown> = {}) {
  return {
    app_language: "ZH",
    project_save_mode: "SOURCE",
    project_fixed_path: "",
    output_folder_open_on_finish: false,
    request_timeout: 120,
    preceding_lines_threshold: 0,
    following_lines_threshold: 0,
    mtool_optimizer_enable: true,
    skip_duplicate_source_text_enable: true,
    glossary_default_preset: "",
    pre_translation_replacement_default_preset: "",
    post_translation_replacement_default_preset: "",
    text_preserve_default_preset: "",
    translation_custom_prompt_default_preset: "",

    recent_projects: [],
    ...overrides,
  };
}

/** 构造页面公开依赖的 DesktopState 测试替身。 */
function create_desktop_runtime_fixture(settings_overrides: Record<string, unknown> = {}) {
  return {
    project_session_stage: null,
    settings_snapshot: create_settings_snapshot(settings_overrides),
    refresh_project_snapshot: vi.fn(),
    set_project_session_status: vi.fn(),
    refresh_settings: vi.fn(async () => {}),
    refresh_batch_translation: vi.fn(async () => {}),
  };
}

/** 安装不访问真实文件系统的桌面桥测试替身。 */
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

/** 按用户可见文案读取按钮，缺失时给出可定位错误。 */
function get_button_by_text(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((element) => {
    return element.textContent?.includes(text) ?? false;
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`未找到按钮：${text}`);
  }

  return button;
}

/** 通过真实拖放入口提交宿主路径，让页面自行完成摘要与选择。 */
async function drop_paths(target: HTMLElement, paths: string[]): Promise<void> {
  const files = paths.map((path) => new File([], path));
  vi.mocked(window.desktopApp.getPathForFile).mockImplementation((file) => file.name);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"], getData: () => "" },
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
}

describe("ProjectPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    window.localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
    desktop_runtime_fixture.current = create_desktop_runtime_fixture();
    install_desktop_app_fixture();
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    };
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/session/source-files/summary") {
        return { source_file_count: 1, format_hit_counts: { txt: 1 } };
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
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  });

  /** 使用真实中文 i18n 资源挂载项目页。 */
  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <ProjectPage is_sidebar_collapsed={false} />
        </LocaleProvider>,
      );
    });
  }

  /** 新建前的语言弹窗渲染在页面容器外，确认后继续创建。 */
  async function confirm_create_languages(): Promise<void> {
    await act(async () => {
      get_button_by_text(document.body, "确认").click();
    });
  }

  /** 销毁页面内存后重新进入，验证持久偏好的恢复。 */
  async function remount_page(): Promise<void> {
    await act(async () => root?.unmount());
    container?.remove();
    await mount_page();
  }

  /** 从来源选择入口打开语言弹窗。 */
  async function open_create_languages(): Promise<void> {
    await act(async () => get_button_by_text(container!, "选择文件").click());
    await act(async () => get_button_by_text(container!, "创建工程").click());
  }

  /** 通过下拉替身的按钮选择场景指定的语言。 */
  async function select_create_languages(source: string, target: string): Promise<void> {
    await act(async () => {
      get_button_by_text(document.body, `source_language:${source}`).click();
      get_button_by_text(document.body, `target_language:${target}`).click();
    });
  }

  /** 读取下拉替身展示的当前语言，供用户行为断言使用。 */
  function read_create_languages() {
    return {
      source_language: document
        .querySelector('[data-field="source_language"]')
        ?.getAttribute("data-value"),
      target_language: document
        .querySelector('[data-field="target_language"]')
        ?.getAttribute("data-value"),
    };
  }

  it.each(["backup", "order", null])("游戏确认取消于 %s，完成确认后才创建工程", async (cancel) => {
    const game_root = "E:/game";
    api_fetch_mock.mockResolvedValueOnce({
      source_file_count: 1,
      contains_game: true,
      format_hit_counts: { godot: 1 },
      godot_packs: [{ game_root, game_name: "game", external_pcks: ["base.pck", "patch.pck"] }],
    });
    await mount_page();
    vi.useFakeTimers();
    await open_create_languages();
    const primary = [...document.querySelectorAll("button")].find((button) =>
      /^\d+s/u.test(button.textContent ?? ""),
    )!;
    expect(primary.disabled).toBe(true);
    expect(document.querySelector('[data-field="source_language"]')).toBeNull();
    if (cancel === "backup") {
      await act(async () => get_button_by_text(document.body, "取消").click());
      expect(document.querySelector('[data-field="source_language"]')).toBeNull();
      expect(
        api_fetch_mock.mock.calls.some(([path]) => path === "/api/session/project/create"),
      ).toBe(false);
      return;
    }
    act(() => vi.advanceTimersByTime(Number.parseInt(primary.textContent!, 10) * 1_000));
    await act(async () => primary.click());
    await confirm_create_languages();
    expect(document.querySelector('[role="dialog"] ol')?.textContent).toContain("base.pck");
    expect(api_fetch_mock.mock.calls.some(([path]) => path === "/api/session/project/create")).toBe(
      false,
    );
    await act(async () => {
      get_button_by_text(document.body, cancel ? "取消" : "确认").click();
    });
    if (cancel)
      expect(
        api_fetch_mock.mock.calls.some(([path]) => path === "/api/session/project/create"),
      ).toBe(false);
    else
      expect(api_fetch_mock).toHaveBeenCalledWith(
        "/api/session/project/create",
        expect.objectContaining({
          godot_pack_orders: [{ game_root, ordered_pcks: ["base.pck", "patch.pck"] }],
        }),
      );
  });

  it.each(["loading", "failed"])("预览 %s 时仍能打开，打开后的迟到结果不再消费", async (state) => {
    const preview = Promise.withResolvers<object>();
    api_fetch_mock.mockImplementation((path: string) =>
      path.endsWith("/preview") ? preview.promise : Promise.resolve({}),
    );
    await mount_page();
    await drop_paths(get_button_by_text(container!, "点击或拖拽 .lg 文件"), ["E:/open.lg"]);
    if (state === "failed") await act(async () => preview.reject(new Error("preview failed")));
    expect(get_button_by_text(container!, "打开工程").disabled).toBe(false);
    expect(push_progress_toast_mock).not.toHaveBeenCalled();
    push_toast_mock.mockClear();
    await act(async () => get_button_by_text(container!, "打开工程").click());
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/project/open", {
      path: "E:/open.lg",
    });
    if (state === "loading") {
      expect(
        api_fetch_mock.mock.calls.find(([path]) => path.endsWith("/preview"))?.[2].aborted,
      ).toBe(true);
      await act(async () => preview.reject(new Error("late preview failure")));
      expect(push_toast_mock).not.toHaveBeenCalled();
    }
    expect(get_button_by_text(container!, "open.lg")).toBeDefined();
  });

  it("点击失效最近工程立即确认移除，取消后保留记录并禁用打开", async () => {
    desktop_runtime_fixture.current = create_desktop_runtime_fixture({
      recent_projects: [{ path: "E:/missing.lg", name: "失效工程" }],
    });
    api_fetch_mock.mockRejectedValueOnce(new DesktopApiError({ code: "project.not_found" }));
    await mount_page();
    await act(async () => get_button_by_text(container!, "失效工程").click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(container!.textContent).not.toContain("工程已就绪");
    expect(get_button_by_text(container!, "打开工程").disabled).toBe(true);
    expect(push_toast_mock).not.toHaveBeenCalled();
    api_fetch_mock.mockClear();
    await act(async () => get_button_by_text(document.body, "取消").click());
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(get_button_by_text(container!, "失效工程")).toBeDefined();
    expect(get_button_by_text(container!, "打开工程").disabled).toBe(true);
    expect(api_fetch_mock).not.toHaveBeenCalled();
  });

  it("高版本确认强调完整版本并接入延迟确认", async () => {
    api_fetch_mock.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path.endsWith("/preview")) throw new Error("preview unavailable");
      if (path.endsWith("/open") && !body.confirmed_target_app_version)
        throw new DesktopApiError({
          code: "project.newer_app_version",
          details: {
            target_app_version: "2.1.0",
            current_app_version: "1.0.0",
          },
        });
      return {};
    });
    await mount_page();
    await drop_paths(get_button_by_text(container!, "点击或拖拽 .lg 文件"), ["E:/newer.lg"]);
    push_toast_mock.mockClear();
    vi.useFakeTimers();
    await act(async () => get_button_by_text(container!, "打开工程").click());
    expect(document.querySelector(".project-home__version-emphasis")?.textContent).toBe("v2.1.0");
    expect(push_toast_mock).not.toHaveBeenCalled();
    const primary = [...document.querySelectorAll("button")].find((button) =>
      /^\d+s/u.test(button.textContent ?? ""),
    )!;
    expect(primary.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(Number.parseInt(primary.textContent!, 10) * 1000));
    await act(async () => primary.click());
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/project/open", {
      path: "E:/newer.lg",
      confirmed_target_app_version: "2.1.0",
    });
  });

  it("保留预览文件顺序并用当前工程文件名记录最近打开", async () => {
    const paths = [
      "folder/chapter03.txt",
      "chapter01.txt",
      "chapter02.txt",
      "chapter04.txt",
      "chapter05.txt",
    ];
    const project_path = "E:/Source/renamed.lg";
    desktop_runtime_fixture.current = create_desktop_runtime_fixture({
      recent_projects: [{ path: project_path, name: "旧来源名称" }],
    });
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/session/project/preview")
        return {
          preview: {
            file_paths: paths,
            created_at: "2020-12-12T12:12:12",
            updated_at: "2026-09-17T14:05:54",
            translation_stats: {
              total_items: 3,
              completed_count: 1,
              skipped_count: 0,
              failed_count: 0,
              pending_count: 2,
              completion_percent: 33,
            },
          },
        };
      return {};
    });
    await mount_page();
    await act(async () => {
      get_button_by_text(container!, "旧来源名称").click();
    });
    expect(container!.textContent).toContain("2020-12-12 12:12:12");
    expect(container!.textContent).toContain("2026-09-17 14:05:54");
    const files_row = container!.querySelector(".project-home__preview-files-row")!;
    const files_badge = files_row.querySelector('[data-slot="badge"]');
    expect(files_badge?.textContent).toBe(`${paths.length} 个文件`);
    expect(
      [...files_row.querySelectorAll('[role="tooltip"] li')].map((element) => element.textContent),
    ).toEqual(paths);
    const progress = container!.querySelector(
      '.project-home__preview-progress [data-slot="badge"]',
    );
    expect(progress?.textContent).toBe("33.00%");
    await act(async () => {
      get_button_by_text(container!, "打开工程").click();
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/project/open", {
      path: project_path,
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/settings/recent-projects/add", {
      path: project_path,
      name: "renamed",
    });
  });

  it("新建工程默认提交 stem.lg，并用后端真实路径写入最近工程", async () => {
    await mount_page();

    await open_create_languages();
    await confirm_create_languages();

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

  it("点击创建先选择工程语言，取消保留来源且不创建", async () => {
    await mount_page();
    await act(async () => {
      get_button_by_text(container!, "选择文件").click();
    });
    await act(async () => {
      get_button_by_text(container!, "创建工程").click();
    });

    expect(document.body.textContent).toContain("工程语言");
    await act(async () => {
      get_button_by_text(document.body, "取消").click();
    });

    expect(api_fetch_mock).not.toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.anything(),
    );
    expect(container!.textContent).toContain("已选择 1 个源文件");
  });

  it("确认后使用所选语言创建，成功后再次新建及重新挂载仍使用该组合", async () => {
    await mount_page();
    await open_create_languages();
    await select_create_languages("EN", "KO");
    await confirm_create_languages();

    const languages = { source_language: "EN", target_language: "KO" };
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({ languages }),
    );
    await open_create_languages();
    expect(read_create_languages()).toEqual(languages);
    await act(async () => get_button_by_text(document.body, "取消").click());

    await remount_page();
    await open_create_languages();
    expect(read_create_languages()).toEqual(languages);
  });

  it("取消语言弹窗保留本次草稿，重新挂载恢复此前确认值", async () => {
    window.localStorage.setItem(
      PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        source_language: "KO",
        target_language: "EN",
      }),
    );
    await mount_page();
    await open_create_languages();
    expect(read_create_languages()).toEqual({ source_language: "KO", target_language: "EN" });
    await select_create_languages("EN", "KO");
    await act(async () => get_button_by_text(document.body, "取消").click());
    await act(async () => get_button_by_text(container!, "创建工程").click());
    expect(read_create_languages()).toEqual({ source_language: "EN", target_language: "KO" });
    expect(api_fetch_mock).not.toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.anything(),
    );

    await remount_page();
    await open_create_languages();
    expect(read_create_languages()).toEqual({ source_language: "KO", target_language: "EN" });
  });

  it("取消保存路径后保留已确认的语言，重新挂载仍可恢复", async () => {
    desktop_runtime_fixture.current = create_desktop_runtime_fixture({
      project_save_mode: "MANUAL",
    });
    await mount_page();
    await open_create_languages();
    await select_create_languages("EN", "KO");
    await confirm_create_languages();

    expect(window.desktopApp.pickProjectSavePath).toHaveBeenCalled();
    expect(api_fetch_mock).not.toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.anything(),
    );
    await act(async () => get_button_by_text(container!, "创建工程").click());
    expect(read_create_languages()).toEqual({ source_language: "EN", target_language: "KO" });

    await remount_page();
    await open_create_languages();
    expect(read_create_languages()).toEqual({ source_language: "EN", target_language: "KO" });
  });

  it("偏好写入失败时仍使用内存草稿创建工程", async () => {
    await mount_page();
    await open_create_languages();
    await select_create_languages("EN", "KO");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await confirm_create_languages();

    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({ languages: { source_language: "EN", target_language: "KO" } }),
    );
    expect(container!.textContent).toContain("点击或拖拽源文件");
  });

  it("确认后使用所选语言创建，失败后重试或重新挂载保留已确认选择", async () => {
    await mount_page();
    await open_create_languages();
    await select_create_languages("EN", "KO");
    api_fetch_mock.mockRejectedValueOnce(new Error("create failed"));
    await confirm_create_languages();
    api_fetch_mock.mockClear(); // 重试载荷必须来自后续请求。
    await act(async () => {
      get_button_by_text(container!, "创建工程").click();
    });
    expect(read_create_languages()).toEqual({ source_language: "EN", target_language: "KO" });
    await remount_page();
    await open_create_languages();
    expect(read_create_languages()).toEqual({ source_language: "EN", target_language: "KO" });
    await confirm_create_languages();
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({ languages: { source_language: "EN", target_language: "KO" } }),
    );
  });

  it("来源摘要失败只提示结果，重新选择仍可恢复", async () => {
    const source = "E:/Source/broken.exe";
    vi.mocked(window.desktopApp.pickProjectSourceFilePath).mockResolvedValueOnce({
      canceled: false,
      paths: [source],
    });
    api_fetch_mock.mockImplementation(async (path: string) =>
      path === "/api/session/source-files/summary"
        ? {
            source_file_count: 0,
            format_hit_counts: {},
            failed_files: [
              {
                source_path: source,
                rel_path: "broken.exe",
                filename: "broken.exe",
                code: "file.io_failed",
                message: "EVB header damaged",
              },
            ],
          }
        : {},
    );
    await mount_page();
    await act(async () => {
      get_button_by_text(container as HTMLElement, "选择文件").click();
    });
    expect(push_toast_mock).toHaveBeenCalledOnce();
    expect(JSON.stringify(push_toast_mock.mock.calls)).not.toContain("EVB header damaged");
    vi.mocked(window.desktopApp.pickProjectSourceFilePath).mockResolvedValueOnce({
      canceled: false,
      paths: ["E:/Source/good.txt"],
    });
    api_fetch_mock.mockResolvedValue({ source_file_count: 1, format_hit_counts: { txt: 1 } });
    await act(async () => {
      get_button_by_text(container as HTMLElement, "选择文件").click();
    });
    expect(get_button_by_text(container as HTMLElement, "创建工程").disabled).toBe(false);
  });

  it("多选源文件后使用完整 source_paths 创建工程", async () => {
    const selected_paths = ["E:\\Source\\a.txt", "E:\\Source\\b.md"];
    vi.mocked(window.desktopApp.pickProjectSourceFilePath).mockResolvedValueOnce({
      canceled: false,
      paths: [...selected_paths, "E:\\Source\\a.txt", " "],
    });
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/session/source-files/summary") {
        return { source_file_count: 2, format_hit_counts: { txt: 1, md: 1 } };
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
    });

    expect(container?.textContent).toContain("已选择 2 个源文件");

    await act(async () => {
      get_button_by_text(container as HTMLElement, "创建工程").click();
    });
    await confirm_create_languages();

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/source-files/summary", {
      source_paths: selected_paths,
    });
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({
        path: "E:\\Source\\a.lg",
        source_paths: selected_paths,
      }),
    );
  });

  it("新批次替换已有来源，按完整集合摘要并按首项创建工程", async () => {
    const source_paths = ["E:/Source/a.txt", "E:/Other/b.md", "E:/Source/folder"];
    await mount_page();
    await drop_paths(get_button_by_text(container!, "点击或拖拽源文件"), ["E:/old.txt"]);
    api_fetch_mock.mockResolvedValueOnce({
      source_file_count: 5,
      format_hit_counts: { txt: 4, md: 1 },
    });
    await drop_paths(get_button_by_text(container!, "已选择 1 个源文件"), [
      ...source_paths,
      source_paths[0]!,
    ]);

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/source-files/summary", {
      source_paths,
    });
    expect(container!.textContent).toContain("已选择 5 个源文件");
    const txt_tag = [...container!.querySelectorAll(".project-home__format-tag")].find((tag) =>
      tag.textContent?.includes("纯文本"),
    );
    expect(txt_tag?.querySelector('[data-slot="badge"]')?.textContent).toBe("4");
    await act(async () => {
      get_button_by_text(container!, "创建工程").click();
    });
    await confirm_create_languages();
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({ source_paths, path: "E:/Source/a.lg" }),
    );
  });

  it("拖入无本地路径时提示并保留已有来源", async () => {
    await mount_page();
    const source_paths = ["E:/keep.txt"];
    await drop_paths(get_button_by_text(container!, "点击或拖拽源文件"), source_paths);
    api_fetch_mock.mockClear();
    await drop_paths(get_button_by_text(container!, "已选择 1 个源文件"), []);
    expect(push_toast_mock).toHaveBeenCalledWith("warning", expect.any(String));
    expect(api_fetch_mock).not.toHaveBeenCalled();
    await act(async () => {
      get_button_by_text(container!, "创建工程").click();
    });
    await confirm_create_languages();
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/session/project/create",
      expect.objectContaining({ source_paths }),
    );
  });

  it("有效路径没有支持的来源时清空旧选择", async () => {
    await mount_page();
    await drop_paths(get_button_by_text(container!, "点击或拖拽源文件"), ["E:/old.txt"]);
    api_fetch_mock.mockResolvedValueOnce({ source_file_count: 0, format_hit_counts: {} });
    await drop_paths(get_button_by_text(container!, "已选择 1 个源文件"), ["E:/empty"]);
    expect(get_button_by_text(container!, "创建工程").disabled).toBe(true);
    expect(get_button_by_text(container!, "点击或拖拽源文件").disabled).toBe(false);
    expect(push_toast_mock).toHaveBeenCalledWith("warning", expect.any(String));
  });

  it("打开区域拒绝多路径并保留已有工程", async () => {
    await mount_page();
    api_fetch_mock.mockResolvedValueOnce({
      preview: {
        file_paths: [],
        created_at: "2026-10-18T00:00:00",
        updated_at: "2026-10-18T00:00:00",
        translation_stats: {
          total_items: 0,
          completed_count: 0,
          skipped_count: 0,
          failed_count: 0,
          pending_count: 0,
          completion_percent: 0,
        },
      },
    });
    await drop_paths(get_button_by_text(container!, "点击或拖拽 .lg 文件"), ["E:/keep.lg"]);
    api_fetch_mock.mockClear();
    await drop_paths(get_button_by_text(container!, "keep.lg"), ["E:/a.lg", "E:/b.lg"]);
    expect(push_toast_mock).toHaveBeenCalledWith("warning", expect.any(String));
    expect(api_fetch_mock).not.toHaveBeenCalled();
    expect(get_button_by_text(container!, "keep.lg")).toBeDefined();
    expect(get_button_by_text(container!, "打开工程").disabled).toBe(false);
  });

  it.each([false, true])(
    "摘要期间禁用选择、拖入、创建和重置，完成后恢复（已有选择：%s）",
    async (has_selection) => {
      await mount_page();
      if (has_selection) {
        await drop_paths(get_button_by_text(container!, "点击或拖拽源文件"), ["E:/old.txt"]);
      }
      const pending = Promise.withResolvers<{
        source_file_count: number;
        format_hit_counts: { md: number };
      }>();
      api_fetch_mock.mockClear();
      api_fetch_mock.mockReturnValueOnce(pending.promise);
      const source_paths = ["E:/new/a.md", "E:/new/b.md"];
      const dropzone_text = has_selection ? "已选择 1 个源文件" : "点击或拖拽源文件";
      await drop_paths(get_button_by_text(container!, dropzone_text), source_paths);
      const dropzone = get_button_by_text(container!, dropzone_text);
      expect(dropzone.disabled).toBe(true);
      expect(get_button_by_text(container!, "创建工程").disabled).toBe(true);
      for (const text of ["选择文件", "选择文件夹"]) {
        const button = get_button_by_text(container!, text);
        expect(button.disabled).toBe(true);
        await act(async () => button.click());
      }
      if (has_selection) {
        const reset = container!.querySelector<HTMLButtonElement>('button[aria-label="重置"]')!;
        expect(reset.disabled).toBe(true);
        await act(async () => reset.click());
      }
      await drop_paths(dropzone, ["E:/ignored.txt"]);
      expect(window.desktopApp.pickProjectSourceFilePath).not.toHaveBeenCalled();
      expect(window.desktopApp.pickProjectSourceDirectoryPath).not.toHaveBeenCalled();
      expect(api_fetch_mock).toHaveBeenCalledExactlyOnceWith("/api/session/source-files/summary", {
        source_paths,
      });
      await act(async () => {
        pending.resolve({ source_file_count: 2, format_hit_counts: { md: 2 } });
      });
      expect(get_button_by_text(container!, "已选择 2 个源文件").disabled).toBe(false);
      expect(get_button_by_text(container!, "创建工程").disabled).toBe(false);
      expect(get_button_by_text(container!, "选择文件").disabled).toBe(false);
      expect(get_button_by_text(container!, "选择文件夹").disabled).toBe(false);
      const reset = container!.querySelector<HTMLButtonElement>('button[aria-label="重置"]')!;
      expect(reset.disabled).toBe(false);
      await act(async () => reset.click());
      expect(get_button_by_text(container!, "创建工程").disabled).toBe(true);
      expect(container!.querySelector('[data-slot="badge"]')).toBeNull();
    },
  );

  it("创建期间禁止修改来源，结束后恢复选择", async () => {
    await mount_page();
    await drop_paths(get_button_by_text(container!, "点击或拖拽源文件"), ["E:/keep.txt"]);
    const pending = Promise.withResolvers<object>();
    api_fetch_mock.mockClear();
    api_fetch_mock.mockReturnValueOnce(pending.promise);
    await act(async () => {
      get_button_by_text(container!, "创建工程").click();
    });
    await confirm_create_languages();
    const dropzone = get_button_by_text(container!, "已选择 1 个源文件");
    expect(dropzone.disabled).toBe(true);
    expect(get_button_by_text(container!, "选择文件").disabled).toBe(true);
    expect(get_button_by_text(container!, "选择文件夹").disabled).toBe(true);
    expect(container!.querySelector<HTMLButtonElement>('button[aria-label="重置"]')!.disabled).toBe(
      true,
    );
    await drop_paths(dropzone, ["E:/ignored.txt"]);
    expect(api_fetch_mock).toHaveBeenCalledExactlyOnceWith(
      "/api/session/project/create",
      expect.objectContaining({ source_paths: ["E:/keep.txt"] }),
    );
    await act(async () => {
      pending.resolve({});
    });
    expect(get_button_by_text(container!, "点击或拖拽源文件").disabled).toBe(false);
  });
});
