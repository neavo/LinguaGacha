import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppTitlebar } from "./app-titlebar";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

describe("AppTitlebar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({ shell: { titleBarControlSide: "right" } }),
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  async function render_titlebar(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<AppTitlebar title="LinguaGacha" />);
    });
  }

  it.each(["1.2.3", "v1.2.3"])("统一展示宿主版本 %s 的前缀", async (version) => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({ appVersion: version }),
    });
    await render_titlebar();

    expect(container?.querySelector("strong")?.textContent).toBe("LinguaGacha v1.2.3");
  });
});
