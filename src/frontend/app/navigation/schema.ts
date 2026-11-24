import { Boxes, Brain, SlidersHorizontal, ToolCase } from "lucide-react";
import type { NavigationGroup, RouteId } from "./types";

export const DEFAULT_ROUTE_ID: RouteId = "agent";
export const GLOBAL_ROUTE_IDS = new Set<RouteId>([
  "model",
  "function-settings",
  "skills",
  "toolbox",
  "game-font",
  "translation-transfer",
]);

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: "configuration",
    items: [
      { id: "model", icon: Boxes, title_key: "model_page.title" },
      {
        id: "function-settings",
        icon: SlidersHorizontal,
        title_key: "function_settings_page.title",
      },
    ],
  },
  {
    id: "tools",
    items: [
      { id: "skills", icon: Brain, title_key: "app.workspace.skills" },
      { id: "toolbox", icon: ToolCase, title_key: "toolbox_page.title" },
    ],
  },
];
