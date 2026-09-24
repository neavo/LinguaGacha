import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentSkillEntry } from "@shared/agent-skills";
import { SkillsPage } from "./page";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), settings: {} }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ settings_snapshot: mocks.settings }),
}));

/** 使用测试自有技能覆盖同名来源，避免依赖动态内置资源。 */
function skill(name: string, source: "builtin" | "user"): AgentSkillEntry {
  return {
    name,
    source,
    enabled: true,
    displayDescriptions: {
      "zh-CN": "描述",
      "en-US": "Description",
      "de-DE": "Beschreibung",
      "ja-JP": "説明",
      "ko-KR": "설명",
    },
  };
}

describe("技能页面", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.toast.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 通过实际页面触发查询与保存，保留组件到接口的绑定。 */
  async function render() {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <SkillsPage />
          </TooltipProvider>
        </LocaleProvider>,
      ),
    );
  }

  it("两组共用卡片，内置把手禁用，同名用户技能正常操作，旧读取不能覆盖保存结果", async () => {
    let skills = [skill("custom", "builtin"), skill("custom", "user"), skill("another", "user")];
    let finish!: () => void;
    let finish_read!: () => void;
    let hold_read = false;
    mocks.api.mockImplementation(
      async (path: string, body: { source: string; name: string; enabled: boolean }) => {
        if (path === "/api/skills/snapshot" && hold_read) {
          const previous = skills;
          await new Promise<void>((resolve) => {
            finish_read = resolve;
          });
          return { skills: previous };
        }
        if (path === "/api/skills/enabled") {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          skills = skills.map((item) =>
            item.source === body.source && item.name === body.name
              ? { ...item, enabled: body.enabled }
              : item,
          );
        }
        return { skills };
      },
    );
    await render();
    const cards = container.querySelectorAll<HTMLElement>(".skills-page__card");
    expect(cards[0]?.querySelector<HTMLButtonElement>(".skills-page__handle")?.disabled).toBe(true);
    expect(cards[1]?.querySelector<HTMLButtonElement>(".skills-page__handle")?.disabled).toBe(
      false,
    );
    expect(cards[2]?.querySelector<HTMLButtonElement>(".skills-page__handle")?.disabled).toBe(
      false,
    );
    const builtin_toggle = cards[0]?.querySelector(
      '.skills-page__actions button[aria-pressed="false"]',
    );
    const toggle = cards[1]?.querySelector<HTMLButtonElement>(
      '.skills-page__actions button[aria-pressed="false"]',
    );
    hold_read = true;
    mocks.settings = {};
    await render();
    await act(async () => toggle?.click());
    expect(mocks.api).toHaveBeenCalledWith("/api/skills/enabled", {
      source: "user",
      name: "custom",
      enabled: false,
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => finish());
    await act(async () => finish_read());
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("success", "将在新的对话中生效 …");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(builtin_toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("保存失败保留原状态并显示错误", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/skills/enabled") throw new Error("disk full");
      return { skills: [skill("custom", "user")] };
    });
    await render();
    const toggle = container.querySelector<HTMLButtonElement>(
      '.skills-page__actions button[aria-pressed="false"]',
    );
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("error", expect.any(String));
  });
});
