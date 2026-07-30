import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  find_text_match_ranges,
  ProofreadingEditDialog,
} from "@frontend/pages/proofreading-page/components/proofreading-edit-dialog";
import type { ProofreadingItem } from "@shared/proofreading/proofreading-types";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => {
          const messages: Record<string, string> = {
            "proofreading_page.action.cancel": "取消",
            "proofreading_page.action.clear_translation": "清空译文",
            "proofreading_page.action.retranslate": "重新翻译",
            "proofreading_page.action.set_translation_status": "设置翻译状态",
            "proofreading_page.action.save": "保存",
            "proofreading_page.action.edit": "编辑",
            "proofreading_page.action.view_context": "查看上下文",
            "proofreading_page.action.back": "返回",
            "proofreading_page.fields.source": "原文",
            "proofreading_page.fields.status": "状态",
            "proofreading_page.fields.translation": "译文",
            "proofreading_page.glossary.miss": "术语全部失效",
            "proofreading_page.glossary.ok": "术语全部生效",
            "proofreading_page.glossary.partial": "术语部分生效",
            "proofreading_page.glossary.tooltip_applied": "术语已生效",
            "proofreading_page.glossary.tooltip_failed": "术语未生效",
            "proofreading_page.status.excluded": "已排除",
            "proofreading_page.status.none": "等待翻译",
            "proofreading_page.status.processed": "翻译成功",
            "proofreading_page.tooltip.glossary_applied_terms": "生效",
            "proofreading_page.tooltip.glossary_failed_terms": "未生效",
          };
          return messages[key] ?? key;
        },
      };
    },
  };
});

vi.mock("@frontend/widgets/interactions/use-action-shortcut", () => {
  return {
    useActionShortcut: () => {},
  };
});

vi.mock("@frontend/widgets/app-editor/app-editor", () => {
  return {
    AppEditor: (props: {
      value: string;
      aria_label: string;
      variant?: "editor" | "field";
      read_only: boolean;
      aria_invalid?: boolean;
      marks?: Array<{ start: number; end: number; tone: "success" | "warning" }>;
      on_change?: (next_value: string) => void;
    }) => {
      const marks = props.marks ?? [];
      return (
        <div
          className={["app-editor", props.variant === "field" ? "app-editor--field" : undefined]
            .filter(Boolean)
            .join(" ")}
          data-variant={props.variant ?? "editor"}
          data-readonly={props.read_only ? "true" : "false"}
          data-mark-count={marks.length}
        >
          <textarea
            aria-label={props.aria_label}
            aria-invalid={props.aria_invalid === true ? true : undefined}
            readOnly={props.read_only}
            data-readonly={props.read_only ? "true" : "false"}
            value={props.value}
            onChange={(event) => {
              props.on_change?.(event.currentTarget.value);
            }}
          />
          {marks.map((mark, index) => (
            <span
              key={`${mark.start}:${mark.end}:${index}`}
              className={`app-text-mark app-text-mark--${mark.tone}`}
              data-tone={mark.tone}
            >
              {props.value.slice(mark.start, mark.end)}
            </span>
          ))}
        </div>
      );
    },
  };
});

vi.mock("@frontend/widgets/app-page-dialog", () => {
  return {
    AppPageDialog: (props: {
      open: boolean;
      title: string;
      children: ReactNode;
      footer?: ReactNode;
      dismissBehavior?: "default" | "escape-only" | "blocked";
      onClose: () => void;
    }) => {
      if (!props.open) {
        return null;
      }

      return (
        <div data-dismiss-behavior={props.dismissBehavior}>
          <h1>{props.title}</h1>
          <main>{props.children}</main>
          <footer>{props.footer}</footer>
          <button type="button" data-dialog-close-probe onClick={props.onClose}>
            dialog-close-probe
          </button>
        </div>
      );
    },
  };
});

vi.mock("@frontend/widgets/app-dropdown-menu", () => {
  return {
    AppDropdownMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuItem: (props: { children: ReactNode }) => <button>{props.children}</button>,
    AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

/**
 * 构造当前场景的标准初始数据。
 */
function create_proofreading_item(): ProofreadingItem {
  return {
    item_id: 1,
    file_path: "chapter01.txt",
    row_number: 1,
    src: "魔法と美優",
    dst: "Magic 和美1优",
    name_src: null,
    name_dst: null,
    status: "PROCESSED",
    retry_count: 0,
    warnings: ["GLOSSARY"],
    warning_fragments_by_code: {},
    applied_glossary_terms: [["魔法", "Magic"]],
    failed_glossary_terms: [["美優", "美优"]],
  };
}

// 构造弹窗公开状态，让用例只覆写当前行为需要的字段。
function create_dialog_state(
  overrides: Partial<ProofreadingDialogState> = {},
): ProofreadingDialogState {
  return {
    open: true,
    target_row_id: "1",
    draft_item: { dst: "Magic 和美1优", name_dst: "" },
    saving: false,
    context: { status: "idle" },
    ...overrides,
  };
}

describe("find_text_match_ranges", () => {
  it("使用 CodeMirror 归一后的换行坐标匹配 Windows 换行文本", () => {
    const text = "そこで注目を浴びているのは、\r\n星継\r\n銀音\r\n。";

    expect(find_text_match_ranges(text, "星継")).toEqual([{ start: 15, end: 17 }]);
    expect(find_text_match_ranges(text, "銀音")).toEqual([{ start: 18, end: 20 }]);
  });

  it("同步归一多行术语片段，避免片段自身含 CRLF 时偏移", () => {
    const text = "alpha\r\nbeta\r\ngamma";

    expect(find_text_match_ranges(text, "beta\r\ngamma")).toEqual([{ start: 6, end: 16 }]);
  });
});

function get_field_editor(container: HTMLElement, value: string): HTMLTextAreaElement {
  const editor = [
    ...container.querySelectorAll<HTMLTextAreaElement>(".app-editor--field textarea"),
  ].find((candidate) => candidate.value === value);
  if (editor === undefined) throw new Error(`缺少字段编辑器：${value}`);
  return editor;
}

describe("ProofreadingEditDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  async function render_dialog(
    props: Partial<ComponentProps<typeof ProofreadingEditDialog>> = {},
  ): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    const rendered = container;

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          state={create_dialog_state()}
          item={create_proofreading_item()}
          readonly={false}
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_open_context={async () => {}}
          on_close_context={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
          {...props}
        />,
      );
    });
    return rendered;
  }

  it("术语检查胶囊的未生效提示使用原文到译文格式", async () => {
    const rendered = await render_dialog();

    expect(rendered.textContent).toContain("魔法 -> Magic");
    expect(rendered.textContent).toContain("美優 -> 美优");
    expect(
      [...rendered.querySelectorAll("[data-variant='editor']")].map((editor) =>
        editor.getAttribute("data-mark-count"),
      ),
    ).toEqual(["2", "1"]);
  });

  it("文件栏按需显示 TRANS 内部路径", async () => {
    const rendered = await render_dialog({
      item: {
        ...create_proofreading_item(),
        file_path: "game.trans",
        internal_file_path: "data/Actors.json",
      },
    });
    const file_path = rendered.querySelector(".proofreading-page__dialog-file-path");

    expect(file_path?.textContent).toBe("game.trans | data/Actors.json");
    expect(file_path?.getAttribute("title")).toBe("game.trans | data/Actors.json");
  });

  it("有姓名字段时显示原文姓名并提交译文姓名草稿", async () => {
    const on_change = vi.fn();

    const rendered = await render_dialog({
      item: {
        ...create_proofreading_item(),
        name_src: ["Alice", "Bob"],
        name_dst: ["旧译名", "保留译名"],
      },
      state: create_dialog_state({
        draft_item: { dst: "Magic 和美1优", name_dst: "旧译名" },
      }),
      on_change,
    });

    const source_input = get_field_editor(rendered, "Alice");
    const translation_input = get_field_editor(rendered, "旧译名");
    expect(source_input.value).toBe("Alice");
    expect(source_input.readOnly).toBe(true);
    expect(source_input.getAttribute("data-readonly")).toBe("true");
    expect(translation_input.readOnly).toBe(false);
    expect(translation_input.disabled).toBe(false);
    expect(translation_input.getAttribute("data-readonly")).toBe("false");
    expect(rendered.querySelector("label.proofreading-page__dialog-editor-section")).toBeNull();

    await act(async () => {
      const value_setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      value_setter?.call(translation_input, "新译名");
      translation_input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(on_change).toHaveBeenCalledWith({ name_dst: "新译名" });
  });

  it("姓名数组首项为空时不显示后续槽位姓名", async () => {
    const rendered = await render_dialog({
      item: {
        ...create_proofreading_item(),
        name_src: ["", "Bob"],
        name_dst: ["", "旧译名"],
      },
    });

    expect(rendered.querySelectorAll(".app-editor--field textarea")).toHaveLength(0);
  });

  it("译文姓名输入框跟随译文框只读态且保持可聚焦", async () => {
    const rendered = await render_dialog({
      item: {
        ...create_proofreading_item(),
        name_src: "Alice",
        name_dst: "旧译名",
      },
      state: create_dialog_state({
        draft_item: { dst: "Magic 和美1优", name_dst: "旧译名" },
      }),
      readonly: true,
    });

    const translation_input = get_field_editor(rendered, "旧译名");

    expect(translation_input.readOnly).toBe(true);
    expect(translation_input.disabled).toBe(false);
    expect(translation_input.getAttribute("data-readonly")).toBe("true");
  });

  it("姓名字段术语状态会跟随姓名译文草稿刷新", async () => {
    const item: ProofreadingItem = {
      ...create_proofreading_item(),
      src: "普通正文",
      dst: "",
      name_src: "Alice",
      name_dst: "",
      applied_glossary_terms: [],
      failed_glossary_terms: [["Alice", "艾丽丝"]],
    };

    const rendered = await render_dialog({
      item,
      state: create_dialog_state({ draft_item: { dst: "", name_dst: "" } }),
    });

    const source_input = get_field_editor(rendered, "Alice");
    const translation_input = get_field_editor(rendered, "");
    const source_root = source_input.closest(".app-editor--field");
    const translation_root = translation_input.closest(".app-editor--field");
    if (source_root === null || translation_root === null) {
      throw new Error("缺少姓名字段编辑器。");
    }
    expect(source_input.getAttribute("aria-invalid")).toBe("true");
    expect(translation_input.getAttribute("aria-invalid")).toBe("true");
    expect(source_root.querySelector(".app-text-mark[data-tone='warning']")?.textContent).toBe(
      "Alice",
    );
    expect(translation_root.querySelector(".app-text-mark[data-tone='warning']")).toBeNull();
    expect(rendered.textContent).toContain("术语全部失效");

    await render_dialog({
      item,
      state: create_dialog_state({ draft_item: { dst: "", name_dst: "艾丽丝" } }),
    });

    const next_source_input = get_field_editor(rendered, "Alice");
    const next_translation_input = get_field_editor(rendered, "艾丽丝");
    const next_source_root = next_source_input.closest(".app-editor--field");
    const next_translation_root = next_translation_input.closest(".app-editor--field");
    if (next_source_root === null || next_translation_root === null) {
      throw new Error("缺少姓名字段编辑器。");
    }
    expect(next_source_input.getAttribute("aria-invalid")).toBeNull();
    expect(next_translation_input.getAttribute("aria-invalid")).toBeNull();
    expect(next_source_root.querySelector(".app-text-mark[data-tone='success']")?.textContent).toBe(
      "Alice",
    );
    expect(
      next_translation_root.querySelector(".app-text-mark[data-tone='success']")?.textContent,
    ).toBe("艾丽丝");
    expect(rendered.textContent).toContain("术语全部生效");
  });

  it("只读时仍可查看上下文且保存中禁用入口", async () => {
    const on_open_context = vi.fn(async () => {});
    const rendered = await render_dialog({ readonly: true, on_open_context });
    const trigger = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("查看上下文"),
    );
    expect(trigger?.disabled).toBe(false);
    await act(async () => trigger?.click());
    expect(on_open_context).toHaveBeenCalledOnce();

    await render_dialog({
      state: create_dialog_state({ saving: true }),
      on_open_context,
    });
    const saving_trigger = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("查看上下文"),
    );
    expect(saving_trigger?.disabled).toBe(true);
  });

  it("编辑态取消按钮显示 Esc 且保存中阻止快捷关闭", async () => {
    const rendered = await render_dialog();
    const cancel_button = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("取消"),
    );

    expect(rendered.querySelector("[data-dismiss-behavior='escape-only']")).not.toBeNull();
    expect(cancel_button?.querySelector("[data-slot='kbd']")?.textContent).toBe("Esc");

    await render_dialog({ state: create_dialog_state({ saving: true }) });
    expect(rendered.querySelector("[data-dismiss-behavior='blocked']")).not.toBeNull();
  });

  it("上下文状态复用当前模态关闭语义并保留隐藏的编辑器", async () => {
    const on_close = vi.fn();
    const on_close_context = vi.fn();
    const rendered = await render_dialog({
      state: create_dialog_state({
        context: {
          status: "ready",
          items: [
            {
              row_id: "1",
              row_number: 1,
              src: "魔法と美優",
              dst: "旧译文",
              name_src: null,
              name_dst: null,
            },
          ],
        },
      }),
      on_close,
      on_close_context,
    });

    expect(rendered.querySelector("[data-dismiss-behavior='default']")).not.toBeNull();
    const back_button = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("返回"),
    );
    expect(back_button?.textContent).not.toContain("返回编辑");
    expect(back_button?.querySelector("[data-slot='kbd']")?.textContent).toBe("Esc");
    expect(rendered.querySelector(".proofreading-page__dialog-form")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(rendered.querySelector("textarea[aria-label='译文']")).not.toBeNull();
    act(() => {
      rendered.querySelector<HTMLButtonElement>("[data-dialog-close-probe]")?.click();
    });
    expect(on_close_context).toHaveBeenCalledOnce();
    expect(on_close).not.toHaveBeenCalled();
  });
});
