import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider, useI18n } from "@frontend/app/locale/locale-provider";

/** 通过子树公开消费的 locale 观察 Provider 更新。 */
function LocaleProbe(): JSX.Element {
  const { locale } = useI18n();
  return <output>{locale}</output>;
}

describe("LocaleProvider", () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  afterEach(async () => {
    await act(async () => root.unmount());
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("data-locale");
  });

  it("向子树和 document 同步当前 locale", async () => {
    await act(async () => {
      root.render(
        <LocaleProvider locale="zh-CN">
          <LocaleProbe />
        </LocaleProvider>,
      );
    });
    expect(container.textContent).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");

    await act(async () => {
      root.render(
        <LocaleProvider locale="ko-KR">
          <LocaleProbe />
        </LocaleProvider>,
      );
    });
    expect(container.textContent).toBe("ko-KR");
    expect(document.documentElement.lang).toBe("ko-KR");
    expect(document.documentElement.dataset.locale).toBe("ko-KR");
  });
});
