import {
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bot,
  BookA,
  BookOpenCheck,
  Boxes,
  FilePenLine,
  FlaskConical,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ToolCase,
} from "lucide-react";

import type { NavigationGroup, RouteId } from "@frontend/app/navigation/types";

export const DEFAULT_ROUTE_ID: RouteId = "project-home";

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: "project",
    items: [
      {
        id: "model",
        icon: Boxes,
        title_key: "model_page.title",
      },
    ],
  },
  {
    id: "task",
    items: [
      {
        id: "agent",
        icon: Bot,
        title_key: "agent_page.title",
      },
      {
        id: "proofreading",
        icon: BookOpenCheck,
        title_key: "proofreading_page.title",
      },
      {
        id: "workbench",
        icon: LayoutDashboard,
        title_key: "workbench_page.title",
      },
    ],
  },
  {
    id: "setting",
    items: [
      {
        id: "function-settings",
        icon: SlidersHorizontal,
        title_key: "function_settings_page.title",
      },
    ],
  },
  {
    id: "quality",
    items: [
      { id: "skills", icon: Sparkles, title_key: "skills_page.title" },
      {
        id: "glossary",
        icon: BookA,
        title_key: "glossary_page.title",
      },
      {
        id: "text-preserve",
        icon: ShieldCheck,
        title_key: "text_preserve_page.title",
      },
      {
        id: "pre-translation-replacement",
        icon: BetweenVerticalStart,
        title_key: "pre_translation_replacement_page.title",
      },
      {
        id: "post-translation-replacement",
        icon: BetweenVerticalEnd,
        title_key: "post_translation_replacement_page.title",
      },
      {
        id: "custom-prompt",
        icon: FilePenLine,
        title_key: "custom_prompt_page.title",
      },
    ],
  },
  {
    id: "extra",
    items: [
      {
        id: "laboratory",
        icon: FlaskConical,
        title_key: "laboratory_page.title",
      },
      {
        id: "toolbox",
        icon: ToolCase,
        title_key: "toolbox_page.title",
      },
    ],
  },
];
