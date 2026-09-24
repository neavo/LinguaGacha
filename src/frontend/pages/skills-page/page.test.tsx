import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentSkillEntry, AgentSkillIdentity } from "@shared/agent-skills";
import { SkillsPage } from "./page";
import { zh_cn_skills_page } from "@shared/i18n/resources/zh-CN/skills-page";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate_to_agent: vi.fn(),
  toast: vi.fn(),
  settings: {},
  owner: null as "agent" | null,
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: mocks.navigate_to_agent }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => ({ owner: mocks.owner }),
  useDesktopState: () => ({ settings_snapshot: mocks.settings }),
}));
vi.mock("./skill-editor", () => ({
  SkillEditor: ({ skill, on_back }: { skill: AgentSkillIdentity; on_back: () => void }) => (
    <button onClick={on_back}>
      {skill.source}/{skill.name}
    </button>
  ),
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
    mocks.navigate_to_agent.mockReset();
    mocks.owner = null;
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

  it("安装帮助可取消，前往 Agent 时携带完整请求和占位选区", async () => {
    mocks.api.mockResolvedValue({ skills: [] });
    await render();
    const help = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${zh_cn_skills_page.install.title}"]`,
    )!;
    await act(async () => help.click());
    /** 通过弹窗中的可见动作文字查找按钮。 */
    const action = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
        (button) => button.textContent === text,
      )!;
    await act(async () => action("取消").click());
    expect(mocks.navigate_to_agent).not.toHaveBeenCalled();
    await act(async () => help.click());
    await act(async () => action("前往 AGENT").click());
    const request = mocks.navigate_to_agent.mock.calls[0]![0];
    expect(request.mode).toBe("replace");
    expect(request.text.slice(request.selection.from, request.selection.to)).toBe(
      zh_cn_skills_page.install.placeholder,
    );
  });

  it("Agent 占用时禁用开关和拖拽但保留详情入口", async () => {
    mocks.owner = "agent";
    mocks.api.mockResolvedValue({ skills: [skill("sample", "user")] });
    await render();
    expect(container.querySelector<HTMLButtonElement>(".skills-page__handle")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".skills-page__open")?.disabled).toBe(false);
    for (const button of container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"))
      expect(button.disabled).toBe(true);
  });

  it.each(["builtin", "user"] as const)(
    "%s 技能条目进入对应详情，把手点击不导航",
    async (source) => {
      mocks.api.mockResolvedValue({ skills: [skill("sample", source)] });
      await render();
      const list = container.querySelector<HTMLElement>(".skills-page__list")!;
      const handle = container.querySelector<HTMLButtonElement>(".skills-page__handle")!;
      await act(async () => handle.click());
      expect(list.hidden).toBe(false);
      const entry = container.querySelector<HTMLButtonElement>(
        'button.skills-page__open[aria-label="sample"]',
      )!;
      await act(async () => entry.click());
      expect(list.hidden).toBe(true);
      const back = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === `${source}/sample`,
      )!;
      await act(async () => back.click());
      expect(list.hidden).toBe(false);
    },
  );

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
    const cards = [...container.querySelectorAll<HTMLElement>(".skills-page__card")].filter(
      (card) =>
        card.querySelector(
          '.skills-page__open[aria-label="custom"], .skills-page__open[aria-label="another"]',
        ),
    );
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
    expect(container.querySelector<HTMLElement>(".skills-page__list")?.hidden).toBe(false);
    expect(mocks.api).toHaveBeenCalledWith("/api/skills/enabled", {
      source: "user",
      name: "custom",
      enabled: false,
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => finish());
    await act(async () => finish_read());
    expect(mocks.toast).not.toHaveBeenCalled();
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
