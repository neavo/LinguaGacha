import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Input } from "./input";
import { Textarea } from "./textarea";

it("文本输入基元默认关闭拼写检查并允许选择", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <>
      <Input />
      <Textarea />
    </>,
  );

  for (const element of host.children) {
    expect(element.getAttribute("spellcheck")).toBe("false");
    expect(element.classList.contains("select-text")).toBe(true);
  }
});
