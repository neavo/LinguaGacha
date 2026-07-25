import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CustomPromptCommandBar } from "@frontend/pages/custom-prompt-page/components/custom-prompt-command-bar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

describe("CustomPromptCommandBar", () => {
  it("自动保存模式不再展示手动保存按钮和快捷键", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <CustomPromptCommandBar
          title_key="translation_prompt_page.title"
          header_title_key="translation_prompt_page.header.title"
          header_description_key="translation_prompt_page.header.description_html"
          enabled
          preset_items={[]}
          preset_menu_open={false}
          readonly={false}
          on_toggle_enabled={async () => true}
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

    expect(html).toContain("custom_prompt_page.action.import");
    expect(html).toContain("custom_prompt_page.action.export");
    expect(html).toContain("custom_prompt_page.action.preset");
    expect(html).not.toContain("custom_prompt_page.action.save");
    expect(html).not.toContain("Ctrl+S");
  });
});
