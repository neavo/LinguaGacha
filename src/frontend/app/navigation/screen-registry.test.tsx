import { describe, expect, it, vi } from "vitest";

vi.mock("@frontend/pages/basic-settings-page/page", () => ({
  BasicSettingsPage: () => null,
}));
vi.mock("@frontend/pages/agent-page/page", () => ({ AgentPage: () => null }));
vi.mock("@frontend/pages/custom-prompt-page/page", () => ({
  CustomPromptPage: () => null,
}));
vi.mock("@frontend/pages/expert-settings-page/page", () => ({ ExpertSettingsPage: () => null }));
vi.mock("@frontend/pages/glossary-page/page", () => ({ GlossaryPage: () => null }));
vi.mock("@frontend/pages/laboratory-page/page", () => ({ LaboratoryPage: () => null }));
vi.mock("@frontend/pages/model-page/page", () => ({ ModelPage: () => null }));
vi.mock("@frontend/pages/proofreading-page/page", () => ({ ProofreadingPage: () => null }));
vi.mock("@frontend/pages/project-page/page", () => ({ ProjectPage: () => null }));
vi.mock("@frontend/pages/text-preserve-page/page", () => ({ TextPreservePage: () => null }));
vi.mock("@frontend/pages/text-replacement-page/page", () => ({
  TextReplacementPage: () => null,
}));
vi.mock("@frontend/pages/toolbox-page/page", () => ({ ToolboxPage: () => null }));
vi.mock("@frontend/pages/ts-conversion-page/page", () => ({ TsConversionPage: () => null }));
vi.mock("@frontend/pages/workbench-page/page", () => ({ WorkbenchPage: () => null }));

import { DEFAULT_ROUTE_ID, NAVIGATION_GROUPS } from "@frontend/app/navigation/schema";
import { SCREEN_REGISTRY } from "@frontend/app/navigation/screen-registry";

describe("SCREEN_REGISTRY", () => {
  it("为默认页和所有导航叶子注册对应标题", () => {
    expect(SCREEN_REGISTRY[DEFAULT_ROUTE_ID]?.title_key).toBe("project_page.title");

    const navigation_leaves = NAVIGATION_GROUPS.flatMap((group) =>
      group.items.flatMap((item) => item.children ?? [item]),
    );
    for (const item of navigation_leaves) {
      expect(SCREEN_REGISTRY[item.id]?.title_key, item.id).toBe(item.title_key);
    }
  });
});
