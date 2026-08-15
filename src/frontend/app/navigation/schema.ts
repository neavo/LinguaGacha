import {
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bot,
  BookA,
  BookOpenCheck,
  Boxes,
  FlaskConical,
  GraduationCap,
  Grid2x2Check,
  LayoutDashboard,
  Radar,
  ReplaceAll,
  ScanText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
        icon: Grid2x2Check,
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
        id: "basic-settings",
        icon: SlidersHorizontal,
        title_key: "basic_settings_page.title",
      },
      {
        id: "expert-settings",
        icon: GraduationCap,
        title_key: "expert_settings_page.title",
      },
    ],
  },
  {
    id: "quality",
    items: [
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
        id: "text-replacement",
        icon: ReplaceAll,
        title_key: "text_replacement_page.title",
        children: [
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
        ],
      },
      {
        id: "custom-prompt",
        icon: BookOpenCheck,
        title_key: "custom_prompt_page.title",
        children: [
          {
            id: "translation-prompt",
            icon: ScanText,
            title_key: "translation_prompt_page.title",
          },
          {
            id: "analysis-prompt",
            icon: Radar,
            title_key: "analysis_prompt_page.title",
          },
        ],
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
        icon: Sparkles,
        title_key: "toolbox_page.title",
      },
    ],
  },
];
