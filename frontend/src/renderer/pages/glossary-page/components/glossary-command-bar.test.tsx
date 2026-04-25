import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shadcn/tooltip";
import { GlossaryCommandBar } from "./glossary-command-bar";

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

describe("GlossaryCommandBar", () => {
  it("命令栏只展示规则管理操作，不展示独立统计入口", () => {
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

    expect(html).toContain("glossary_page.action.create");
    expect(html).toContain("Ctrl+N");
    expect(html).toContain("Del");
    expect(html).toContain("glossary_page.action.preset");
    expect(html).not.toContain("glossary_page.action.statistics");
  });
});
