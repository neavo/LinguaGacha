import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shadcn/tooltip";
import { NameFieldExtractionCommandBar } from "./name-field-extraction-command-bar";

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

describe("NameFieldExtractionCommandBar", () => {
  it("删除按钮展示平台化快捷键提示", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <NameFieldExtractionCommandBar
          row_count={2}
          pending_count={1}
          selected_count={1}
          run_state={{ extracting: false, translating: false, current_translating_row_id: null }}
          is_running={false}
          on_extract={async () => {}}
          on_translate={async () => {}}
          on_delete={() => {}}
          on_import={async () => {}}
        />
      </TooltipProvider>,
    );

    expect(html).toContain("name_field_extraction_page.action.delete");
    expect(html).toContain("Del");
  });
});
