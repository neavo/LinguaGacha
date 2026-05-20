import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  find_text_match_ranges,
  ProofreadingEditDialog,
} from "@/pages/proofreading-page/components/proofreading-edit-dialog";
import type { ProofreadingItem } from "@/pages/proofreading-page/types";

vi.mock("@/app/locale/locale-provider", () => {
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
            "proofreading_page.fields.status": "状态",
            "proofreading_page.fields.translation": "译文",
            "proofreading_page.glossary.miss": "术语全部失效",
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

vi.mock("@/hooks/use-action-shortcut", () => {
  return {
    useActionShortcut: () => {},
  };
});

vi.mock("@/pages/proofreading-page/components/proofreading-code-editor", () => {
  return {
    ProofreadingCodeEditor: (props: { value: string }) => <pre>{props.value}</pre>,
  };
});

vi.mock("@/widgets/app-page-dialog/app-page-dialog", () => {
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

vi.mock("@/widgets/app-dropdown-menu/app-dropdown-menu", () => {
  return {
    AppDropdownMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuItem: (props: { children: ReactNode }) => <button>{props.children}</button>,
    AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

function create_proofreading_item(): ProofreadingItem {
  return {
    item_id: 1,
    file_path: "chapter01.txt",
    row_number: 1,
    src: "魔法と美優",
    dst: "Magic 和美1优",
    status: "PROCESSED",
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
          draft_dst="Magic 和美1优"
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
  });
});
