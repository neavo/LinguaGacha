import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingEditDialog } from "@frontend/pages/proofreading-page/components/proofreading-edit-dialog";
import type { ProofreadingItem } from "@shared/proofreading/proofreading-types";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
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
    AppDropdownMenuTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
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
    glossary_applications: [
      {
        entry_id: "magic",
        src: "魔法",
        dst: "Magic",
        case_sensitive: false,
        fields: [{ source_field: "src", target_field: "dst", applied: true }],
      },
      {
        entry_id: "miyu",
        src: "美優",
        dst: "美优",
        case_sensitive: false,
        fields: [{ source_field: "src", target_field: "dst", applied: false }],
      },
    ],
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

function get_name_textboxes(
  container: HTMLElement,
): readonly [HTMLTextAreaElement, HTMLTextAreaElement] {
  const editors = container.querySelectorAll<HTMLTextAreaElement>(".app-editor--field textarea");
  const source = editors.item(0);
  const translation = editors.item(1);
  if (source === null || translation === null) throw new Error("缺少姓名字段编辑器。");
  return [source, translation];
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

  it("术语检查胶囊的未落实提示使用原文到译文格式", async () => {
    const rendered = await render_dialog();

    expect(rendered.textContent).toContain("魔法 -> Magic");
    expect(rendered.textContent).toContain("美優 -> 美优");
    expect(
      [...rendered.querySelectorAll("[data-variant='editor']")].map((editor) =>
        editor.getAttribute("data-mark-count"),
      ),
    ).toEqual(["2", "1"]);
  });

  it("外文残留胶囊显示完整残留片段", async () => {
    const rendered = await render_dialog({
      item: {
        ...create_proofreading_item(),
        warnings: ["FOREIGN_CHAR_RESIDUE"],
        warning_fragments_by_code: { FOREIGN_CHAR_RESIDUE: ["か\u3099", "OpenAI"] },
        glossary_applications: [],
      },
    });

    expect(rendered.textContent).toContain("proofreading_page.warning.foreign_char_residue");
    expect(rendered.textContent).toContain(
      "proofreading_page.tooltip.foreign_char_residue_fragments",
    );
    expect(rendered.textContent).toContain("か\u3099");
    expect(rendered.textContent).toContain("OpenAI");
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

    const [source_input, translation_input] = get_name_textboxes(rendered);
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

    const [, translation_input] = get_name_textboxes(rendered);

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
      glossary_applications: [
        {
          entry_id: "alice",
          src: "Alice",
          dst: "艾丽丝",
          case_sensitive: false,
          fields: [{ source_field: "name_src", target_field: "name_dst", applied: false }],
        },
      ],
    };

    const rendered = await render_dialog({
      item,
      state: create_dialog_state({ draft_item: { dst: "", name_dst: "" } }),
    });

    const [source_input, translation_input] = get_name_textboxes(rendered);
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
    expect(rendered.textContent).toContain("proofreading_page.glossary.missing");

    await render_dialog({
      item,
      state: create_dialog_state({ draft_item: { dst: "", name_dst: "艾丽丝" } }),
    });

    const [next_source_input, next_translation_input] = get_name_textboxes(rendered);
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
    expect(rendered.textContent).toContain("proofreading_page.glossary.applied");
  });

  it("只读时仍可查看上下文且保存中禁用入口", async () => {
    const on_open_context = vi.fn(async () => {});
    const rendered = await render_dialog({ readonly: true, on_open_context });
    const trigger = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("proofreading_page.action.view_context"),
    );
    expect(trigger?.disabled).toBe(false);
    await act(async () => trigger?.click());
    expect(on_open_context).toHaveBeenCalledOnce();

    await render_dialog({
      state: create_dialog_state({ saving: true }),
      on_open_context,
    });
    const saving_trigger = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("proofreading_page.action.view_context"),
    );
    expect(saving_trigger?.disabled).toBe(true);
  });

  it("编辑态取消按钮显示 Esc 且保存中阻止快捷关闭", async () => {
    const rendered = await render_dialog();
    const cancel_button = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("app.action.cancel"),
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
      button.textContent?.includes("proofreading_page.action.back"),
    );
    expect(back_button?.querySelector("[data-slot='kbd']")?.textContent).toBe("Esc");
    expect(rendered.querySelector(".proofreading-page__dialog-form")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(
      rendered.querySelector("textarea[aria-label='proofreading_page.fields.translation']"),
    ).not.toBeNull();
    act(() => {
      rendered.querySelector<HTMLButtonElement>("[data-dialog-close-probe]")?.click();
    });
    expect(on_close_context).toHaveBeenCalledOnce();
    expect(on_close).not.toHaveBeenCalled();
  });
});
