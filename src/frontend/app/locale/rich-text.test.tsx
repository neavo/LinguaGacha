import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { render_rich_text } from "@frontend/app/locale/rich-text";

describe("render_rich_text", () => {
  function render(source_text: string): string {
    return renderToStaticMarkup(
      <>{render_rich_text(source_text, { emphasis: (children) => <strong>{children}</strong> })}</>,
    );
  }

  it("保留未注册标签的字面文本", () => {
    expect(render("<ruby>漢字<rt>かんじ</rt></ruby>")).toBe(
      "&lt;ruby&gt;漢字&lt;rt&gt;かんじ&lt;/rt&gt;&lt;/ruby&gt;",
    );
  });

  it("继续渲染已注册的富文本标签", () => {
    expect(render("翻译 <emphasis>GalGame</emphasis> 文本")).toBe(
      "翻译 <strong>GalGame</strong> 文本",
    );
  });
});
