import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GlossaryCommandBar } from "@/pages/glossary-page/components/glossary-command-bar";
import { TextPreserveCommandBar } from "@/pages/text-preserve-page/components/text-preserve-command-bar";
import { TextReplacementCommandBar } from "@/pages/text-replacement-page/components/text-replacement-command-bar";
import { TooltipProvider } from "@/shadcn/tooltip";

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

describe("quality command bars", () => {
  it("术语表命令栏不再渲染统计按钮", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <GlossaryCommandBar
          enabled
          preset_items={[]}
          preset_menu_open={false}
          selected_entry_count={0}
          on_toggle_enabled={async () => {}}
          on_create={() => {}}
          on_delete_selected={async () => {}}
          on_import={async () => {}}
          on_export={async () => {}}
          on_open_preset_menu={async () => {}}
          on_apply_preset={async () => {}}
          on_request_reset={() => {}}
          on_request_save_preset={() => {}}
          on_request_rename_preset={() => {}}
          on_request_delete_preset={() => {}}
          on_set_default_preset={async () => {}}
          on_cancel_default_preset={async () => {}}
          on_preset_menu_open_change={() => {}}
        />
      </TooltipProvider>,
    );

    expect(html).not.toContain("glossary_page.action.statistics");
  });

  it("文本保护命令栏不再渲染统计按钮", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TextPreserveCommandBar
          title_key="text_preserve_page.title"
          mode="custom"
          mode_updating={false}
          preset_items={[]}
          preset_menu_open={false}
          selected_entry_count={0}
          on_mode_change={async () => {}}
          on_create={() => {}}
          on_delete_selected={async () => {}}
          on_import={async () => {}}
          on_export={async () => {}}
          on_open_preset_menu={async () => {}}
          on_apply_preset={async () => {}}
          on_request_reset={() => {}}
          on_request_save_preset={() => {}}
          on_request_rename_preset={() => {}}
          on_request_delete_preset={() => {}}
          on_set_default_preset={async () => {}}
          on_cancel_default_preset={async () => {}}
          on_preset_menu_open_change={() => {}}
        />
      </TooltipProvider>,
    );

    expect(html).not.toContain("text_preserve_page.action.statistics");
  });

  it("文本替换命令栏不再渲染统计按钮", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TextReplacementCommandBar
          title_key="pre_translation_replacement_page.title"
          enabled
          preset_items={[]}
          preset_menu_open={false}
          selected_entry_count={0}
          on_toggle_enabled={async () => {}}
          on_create={() => {}}
          on_delete_selected={async () => {}}
          on_import={async () => {}}
          on_export={async () => {}}
          on_open_preset_menu={async () => {}}
          on_apply_preset={async () => {}}
          on_request_reset={() => {}}
          on_request_save_preset={() => {}}
          on_request_rename_preset={() => {}}
          on_request_delete_preset={() => {}}
          on_set_default_preset={async () => {}}
          on_cancel_default_preset={async () => {}}
          on_preset_menu_open_change={() => {}}
        />
      </TooltipProvider>,
    );

    expect(html).not.toContain("text_replacement_page.action.statistics");
  });
});
