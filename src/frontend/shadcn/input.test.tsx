import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Input } from "./input";

it("文本输入默认关闭拼写检查，只读时仍可选择", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<Input readOnly />);
  const input = host.querySelector("input");

  expect(input?.readOnly).toBe(true);
  expect(input?.disabled).toBe(false);
  expect(input?.getAttribute("spellcheck")).toBe("false");
  expect(input?.classList.contains("select-text")).toBe(true);
});
