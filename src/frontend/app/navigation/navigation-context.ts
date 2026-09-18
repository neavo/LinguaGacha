import { createContext, useContext } from "react";
import type { ProofreadingLookupIntent, RouteId } from "@frontend/app/navigation/types";

export type AppNavigationContextValue = {
  selected_route: RouteId;
  navigate_to_route: (route_id: RouteId) => void;
  proofreading_lookup_intent: ProofreadingLookupIntent | null;
  push_proofreading_lookup_intent: (intent: ProofreadingLookupIntent) => void;
  clear_proofreading_lookup_intent: () => void;
};

export const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

/** 页面通过共享导航入口提交路由与校对查找意图。 */
export function useAppNavigation(): AppNavigationContextValue {
  const value = useContext(AppNavigationContext);
  if (value === null) {
    throw new Error("useAppNavigation must be used inside AppNavigationProvider");
  }

  return value;
}
