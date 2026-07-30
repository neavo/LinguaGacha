import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Textarea } from "./textarea";

it("多行输入默认关闭拼写检查，只读时仍可选择", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<Textarea readOnly />);
  const textarea = host.querySelector("textarea");

  expect(textarea?.readOnly).toBe(true);
  expect(textarea?.disabled).toBe(false);
  expect(textarea?.getAttribute("spellcheck")).toBe("false");
  expect(textarea?.classList.contains("select-text")).toBe(true);
});
