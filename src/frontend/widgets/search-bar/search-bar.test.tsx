import type { ChangeEvent, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchBar, type SearchBarScopeOption } from "@frontend/widgets/search-bar/search-bar";

vi.mock("@frontend/widgets/app-button", () => {
  return {
    AppButton: (props: {
      "aria-label"?: string;
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      type?: "button";
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
    Card: (props: { children: ReactNode; className?: string; role?: string; variant?: string }) => (
      <section role={props.role} className={props.className} data-variant={props.variant}>
        {props.children}
      </section>
    ),
    CardContent: (props: { children: ReactNode; className?: string }) => (
      <div className={props.className}>{props.children}</div>
    ),
  };
});

vi.mock("@frontend/widgets/app-dropdown-menu", () => {
  return {
    AppDropdownMenu: (props: { children: ReactNode }) => <>{props.children}</>,
    AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuRadioGroup: (props: {
      children: ReactNode;
      onValueChange?: (value: string) => void;
      value: string;
    }) => (
      <div data-scope-value={props.value} data-testid="search-bar-scope-options">
        {props.children}
      </div>
    ),
    AppDropdownMenuRadioItem: (props: { children: ReactNode; value: string }) => (
      <div data-value={props.value}>{props.children}</div>
    ),
    AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/shadcn/input-group", () => {
  return {
    InputGroup: (props: { children: ReactNode; className?: string; "data-disabled"?: string }) => (
      <div className={props.className} data-disabled={props["data-disabled"]}>
        {props.children}
      </div>
    ),
    InputGroupAddon: (props: { children: ReactNode; className?: string }) => (
      <div className={props.className}>{props.children}</div>
    ),
    InputGroupButton: (props: {
      "aria-label"?: string;
      children: ReactNode;
      className?: string;
      disabled?: boolean;
      onClick?: () => void;
      size?: string;
      type?: "button";
    }) => (
      <button
        type={props.type ?? "button"}
        aria-label={props["aria-label"]}
        className={props.className}
        disabled={props.disabled}
        data-size={props.size}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    ),
    InputGroupInput: (props: {
      "aria-invalid"?: boolean;
      className?: string;
      disabled?: boolean;
      onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
      placeholder?: string;
      value: string;
    }) => (
      <input
        aria-invalid={props["aria-invalid"]}
        className={props.className}
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={props.value}
        onChange={props.onChange}
      />
    ),
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

type TestScope = "all" | "src";

const SCOPE_OPTIONS: SearchBarScopeOption<TestScope>[] = [
  { value: "all", label: "全部" },
  { value: "src", label: "原文" },
];

type RenderSearchBarOptions = {
  invalid_message?: string | null;
  keyword?: string;
  on_replace_all?: () => void;
  on_replace_next?: () => void;
  replace_actions_disabled?: boolean;
  replace_text?: string;
  search_disabled?: boolean;
};

// 组件外壳在本测试中只提供 DOM 载体，断言集中在 SearchBar 的能力锁语义。
describe("SearchBar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let replace_next_calls = 0;
  let replace_all_calls = 0;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    replace_next_calls = 0;
    replace_all_calls = 0;
  });

  /**
   * 挂载替换模式搜索条，允许单个用例只覆写要验证的能力状态。
   */
  async function render_search_bar(options: RenderSearchBarOptions = {}): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SearchBar<TestScope>
          variant="replace"
          keyword={options.keyword ?? "苹果"}
          placeholder="搜索"
          clear_label="清空搜索"
          invalid_message={options.invalid_message ?? null}
          search_disabled={options.search_disabled}
          on_keyword_change={() => undefined}
          replace_text={options.replace_text ?? "梨"}
          replace_placeholder="替换为"
          replace_clear_label="清空替换"
          replace_actions_disabled={options.replace_actions_disabled}
          on_replace_text_change={() => undefined}
          replace_next_label="替换当前"
          replace_all_label="全部替换"
          on_replace_next={
            options.on_replace_next ??
            (() => {
              replace_next_calls += 1;
            })
          }
          on_replace_all={
            options.on_replace_all ??
            (() => {
              replace_all_calls += 1;
            })
          }
          scope={{
            value: "all",
            button_label: "范围",
            aria_label: "搜索范围",
            tooltip: "当前范围",
            options: SCOPE_OPTIONS,
            on_change: () => undefined,
          }}
          regex={{
            value: false,
            label: "正则",
            tooltip: "正则开关",
            enabled_label: "已启用",
            disabled_label: "已禁用",
            on_change: () => undefined,
          }}
        />,
      );
    });
  }

  /**
   * 按占位文案定位公开输入框，避免测试依赖组件内部 class。
   */
  function query_input(placeholder: string): HTMLInputElement {
    const input = container?.querySelector(`input[placeholder='${placeholder}']`);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`缺少输入框：${placeholder}`);
    }
    return input;
  }

  /**
   * 按无障碍标签定位工具按钮，验证用户可触达的禁用状态。
   */
  function query_button_by_label(label: string): HTMLButtonElement {
    const button = container?.querySelector(`button[aria-label='${label}']`);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`缺少按钮：${label}`);
    }
    return button;
  }

  /**
   * 按按钮文本定位带可见文案的搜索动作。
   */
  function query_button_by_text(text: string): HTMLButtonElement {
    const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) => {
      return candidate.textContent?.includes(text);
    });
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`缺少按钮文本：${text}`);
    }
    return button;
  }

  /**
   * 替换当前项和全部替换共享提交锁，测试中统一断言两者一致。
   */
  function expect_replace_submit_disabled(disabled: boolean): void {
    expect(query_button_by_label("替换当前").disabled).toBe(disabled);
    expect(query_button_by_label("全部替换").disabled).toBe(disabled);
  }

  it("本地写入语义下锁住搜索控件并保留替换文本编辑", async () => {
    await render_search_bar({
      search_disabled: true,
      replace_actions_disabled: true,
    });

    expect(query_input("搜索").disabled).toBe(true);
    expect(query_button_by_label("清空搜索").disabled).toBe(true);
    expect(query_button_by_label("搜索范围").disabled).toBe(true);
    expect(query_button_by_text("正则").disabled).toBe(true);
    expect(query_input("替换为").disabled).toBe(false);
    expect(query_button_by_label("清空替换").disabled).toBe(false);
    expect_replace_submit_disabled(true);
  });

  it("替换动作锁定时保持搜索控件和替换文本可编辑", async () => {
    await render_search_bar({
      replace_actions_disabled: true,
    });

    expect(query_input("搜索").disabled).toBe(false);
    expect(query_button_by_label("清空搜索").disabled).toBe(false);
    expect(query_button_by_label("搜索范围").disabled).toBe(false);
    expect(query_button_by_text("正则").disabled).toBe(false);
    expect(query_input("替换为").disabled).toBe(false);
    expect_replace_submit_disabled(true);
  });

  it.each([
    { name: "空白关键词", keyword: "   ", replace_text: "梨", invalid_message: null },
    { name: "空替换文本", keyword: "苹果", replace_text: "", invalid_message: null },
    { name: "正则错误", keyword: "(", replace_text: "梨", invalid_message: "正则无效" },
  ])("$name 时禁用替换提交", async (scenario) => {
    await render_search_bar({
      keyword: scenario.keyword,
      replace_text: scenario.replace_text,
      invalid_message: scenario.invalid_message,
    });

    expect_replace_submit_disabled(true);
  });

  it("搜索可用且替换前置条件满足时触发替换动作", async () => {
    await render_search_bar();

    expect_replace_submit_disabled(false);

    await act(async () => {
      query_button_by_label("替换当前").click();
      query_button_by_label("全部替换").click();
    });

    expect(replace_next_calls).toBe(1);
    expect(replace_all_calls).toBe(1);
  });
});
