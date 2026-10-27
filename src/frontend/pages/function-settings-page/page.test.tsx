import { type ReactNode, act } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FunctionSettingsPage } from "@frontend/pages/function-settings-page/page";

const { function_settings_state_fixture, push_toast_mock } = vi.hoisted(() => {
  return {
    function_settings_state_fixture: {
      current: null as ReturnType<typeof create_function_settings_state_fixture> | null,
    },
    push_toast_mock: vi.fn(),
  };
});

vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast_mock,
  push_toast: push_toast_mock,
}));

vi.mock("@frontend/pages/function-settings-page/use-function-settings-state", () => {
  return {
    useFunctionSettingsState: () => function_settings_state_fixture.current,
  };
});

vi.mock("@frontend/widgets/setting-card-row/setting-card-row", () => {
  return {
    SettingCardRow: (props: { title: string; action: ReactNode }) => (
      <section aria-label={props.title}>{props.action}</section>
    ),
  };
});

vi.mock("@frontend/widgets/boolean-segmented-toggle", () => {
  return {
    BooleanSegmentedToggle: () => <button type="button" />,
  };
});

vi.mock("@frontend/shadcn/select", () => {
  return {
    Select: (props: {
      items: { value: string; label: string }[];
      value: string;
      disabled: boolean;
      onValueChange: (value: string) => void;
    }) => (
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onValueChange(event.target.value)}
      >
        {props.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    SelectContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectItem: (props: { children: ReactNode; value: string }) => (
      <div data-value={props.value}>{props.children}</div>
    ),
    SelectTrigger: (props: { children: ReactNode }) => (
      <button type="button">{props.children}</button>
    ),
    SelectValue: () => <span />,
  };
});

/** 隔离页面输入行为，保存结果由状态 Hook 测试验证。 */
function create_function_settings_state_fixture() {
  return {
    snapshot: {
      project_save_mode: "MANUAL",
      project_fixed_path: "",
      translation_save_mode: "PROJECT",
      translation_fixed_path: "",
      output_folder_open_on_finish: false,
      request_timeout: 300,
      preceding_lines_threshold: 2,
      following_lines_threshold: 0,
    },
    pending_state: {
      project_save_mode: false,
      translation_save_mode: false,
      output_folder_open_on_finish: false,
      request_timeout: false,
      preceding_lines_threshold: false,
      following_lines_threshold: false,
    },
    choosing_directory: { project_save_mode: false, translation_save_mode: false },
    update_translation_save_mode: vi.fn(),
    languages: { source_language: "JA", target_language: "ZH" },
    language_pending_state: { source_language: false, target_language: false },
    language_locked: false,
    runtime_locked: false,
    update_source_language: vi.fn(async (_next_language: string) => {}),
    update_target_language: vi.fn(async (_next_language: string) => {}),
    update_project_save_mode: vi.fn(async (_next_mode: "MANUAL" | "FIXED" | "SOURCE") => {}),
    update_output_folder_open_on_finish: vi.fn(async (_next_checked: boolean) => {}),
    update_preceding_lines_threshold: vi.fn(async (_next_value: number) => {}),
    update_following_lines_threshold: vi.fn(async (_next_value: number) => {}),
    update_request_timeout: vi.fn(async (_next_value: number) => {}),
  };
}

/** 经原生 setter 和输入事件触发 React 的受控输入更新。 */
function set_input_value(input: HTMLInputElement, value: string): void {
  const value_setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (value_setter === undefined) {
    throw new Error("当前测试环境缺少 input value setter。");
  }

  value_setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 读取当前用例的隔离夹具，未初始化时立即暴露错误。 */
function get_current_function_settings_state(): ReturnType<
  typeof create_function_settings_state_fixture
> {
  if (function_settings_state_fixture.current === null) {
    throw new Error("功能设置页面测试状态尚未初始化。");
  }

  return function_settings_state_fixture.current;
}

describe("FunctionSettingsPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    function_settings_state_fixture.current = create_function_settings_state_fixture();
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
    push_toast_mock.mockReset();
  });

  /** 挂载真实页面以验证输入、失焦与键盘提交。 */
  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<FunctionSettingsPage is_sidebar_collapsed={false} />);
    });
  }

  it.each(["project_save_mode", "translation_save_mode"] as const)(
    "%s 只提交对应保存位置",
    async (field) => {
      await mount_page();
      const select = container!.querySelector<HTMLSelectElement>(
        `[aria-label="function_settings_page.fields.${field}.title"] select`,
      )!;
      await act(async () => {
        select.value = "FIXED";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const state = get_current_function_settings_state();
      expect(state[`update_${field}`]).toHaveBeenCalledExactlyOnceWith("FIXED");
      const other = field === "project_save_mode" ? "translation_save_mode" : "project_save_mode";
      expect(state[`update_${other}`]).not.toHaveBeenCalled();
    },
  );

  it.each(["preceding_lines_threshold", "following_lines_threshold"] as const)(
    "%s 提交到对应设置入口",
    async (field) => {
      await mount_page();
      const input = container!.querySelector<HTMLInputElement>(
        `input[aria-label="function_settings_page.fields.${field}.title"]`,
      )!;
      await act(async () => set_input_value(input, "7"));
      await act(async () =>
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
      );
      expect(
        get_current_function_settings_state()[`update_${field}`],
      ).toHaveBeenCalledExactlyOnceWith(7);
      const other =
        field === "preceding_lines_threshold"
          ? "following_lines_threshold"
          : "preceding_lines_threshold";
      expect(get_current_function_settings_state()[`update_${other}`]).not.toHaveBeenCalled();
    },
  );
});
