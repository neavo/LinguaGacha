import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  find_text_match_ranges,
  ProofreadingEditDialog,
} from "@frontend/pages/proofreading-page/components/proofreading-edit-dialog";
import type { ProofreadingItem } from "@shared/proofreading/proofreading-types";

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
            "proofreading_page.dialog.edit_title": "编辑条目",
            "proofreading_page.fields.source": "原文",
            "proofreading_page.fields.source_name": "原文姓名",
            "proofreading_page.fields.status": "状态",
            "proofreading_page.fields.translation": "译文",
            "proofreading_page.fields.translation_name": "译文姓名",
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
    }) => {
      if (!props.open) {
        return null;
      }

      return (
        <div>
          <h1>{props.title}</h1>
          <main>{props.children}</main>
          <footer>{props.footer}</footer>
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

  it("术语检查胶囊的未生效提示使用原文到译文格式", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={create_proofreading_item()}
          draft_item={{ dst: "Magic 和美1优", name_dst: "" }}
          saving={false}
          readonly={false}
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("魔法 -> Magic");
    expect(container.textContent).toContain("美優 -> 美优");
    expect(
      [...container.querySelectorAll("[data-variant='editor']")].map((editor) =>
        editor.getAttribute("data-mark-count"),
      ),
    ).toEqual(["2", "1"]);
  });

  it("有姓名字段时显示原文姓名并提交译文姓名草稿", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_change = vi.fn();

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={{
            ...create_proofreading_item(),
            name_src: ["Alice", "Bob"],
            name_dst: ["旧译名", "保留译名"],
          }}
          draft_item={{ dst: "Magic 和美1优", name_dst: "旧译名" }}
          saving={false}
          readonly={false}
          on_change={on_change}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    const source_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='原文姓名']",
    );
    const translation_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='译文姓名']",
    );
    if (source_input === null || translation_input === null) {
      throw new Error("缺少姓名输入框。");
    }
    expect(source_input.value).toBe("Alice");
    expect(source_input.readOnly).toBe(true);
    expect(source_input.getAttribute("data-readonly")).toBe("true");
    expect(translation_input.readOnly).toBe(false);
    expect(translation_input.disabled).toBe(false);
    expect(translation_input.getAttribute("data-readonly")).toBe("false");
    expect(container.querySelector("label.proofreading-page__dialog-editor-section")).toBeNull();

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
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={{
            ...create_proofreading_item(),
            name_src: ["", "Bob"],
            name_dst: ["", "旧译名"],
          }}
          draft_item={{ dst: "Magic 和美1优", name_dst: "" }}
          saving={false}
          readonly={false}
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    expect(container.querySelector("textarea[aria-label='原文姓名']")).toBeNull();
    expect(container.querySelector("textarea[aria-label='译文姓名']")).toBeNull();
  });

  it("译文姓名输入框跟随译文框只读态且保持可聚焦", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={{
            ...create_proofreading_item(),
            name_src: "Alice",
            name_dst: "旧译名",
          }}
          draft_item={{ dst: "Magic 和美1优", name_dst: "旧译名" }}
          saving={false}
          readonly
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    const translation_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='译文姓名']",
    );
    if (translation_input === null) {
      throw new Error("缺少译文姓名输入框。");
    }

    expect(translation_input.readOnly).toBe(true);
    expect(translation_input.disabled).toBe(false);
    expect(translation_input.getAttribute("data-readonly")).toBe("true");
  });

  it("姓名字段术语状态会跟随姓名译文草稿刷新", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const item: ProofreadingItem = {
      ...create_proofreading_item(),
      src: "普通正文",
      dst: "",
      name_src: "Alice",
      name_dst: "",
      applied_glossary_terms: [],
      failed_glossary_terms: [["Alice", "艾丽丝"]],
    };

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={item}
          draft_item={{ dst: "", name_dst: "" }}
          saving={false}
          readonly={false}
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    const source_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='原文姓名']",
    );
    const translation_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='译文姓名']",
    );
    if (source_input === null || translation_input === null) {
      throw new Error("缺少姓名输入框。");
    }
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
    expect(container.textContent).toContain("术语全部失效");

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={item}
          draft_item={{ dst: "", name_dst: "艾丽丝" }}
          saving={false}
          readonly={false}
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    const next_source_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='原文姓名']",
    );
    const next_translation_input = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='译文姓名']",
    );
    if (next_source_input === null || next_translation_input === null) {
      throw new Error("缺少姓名输入框。");
    }
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
    expect(container.textContent).toContain("术语全部生效");
  });

  it("无姓名字段时保持正文编辑布局", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProofreadingEditDialog
          open
          item={create_proofreading_item()}
          draft_item={{ dst: "Magic 和美1优", name_dst: "" }}
          saving={false}
          readonly={false}
          on_change={() => {}}
          on_save={async () => {}}
          on_close={() => {}}
          on_request_retranslate={() => {}}
          on_request_clear_translation={() => {}}
          on_request_set_translation_status={() => {}}
        />,
      );
    });

    expect(container.querySelector("textarea[aria-label='原文姓名']")).toBeNull();
    expect(container.querySelector("textarea[aria-label='译文姓名']")).toBeNull();
  });
});
