import { useMemo, useState, type ReactNode } from "react";
import type { ProofreadingLookupIntent, RouteId } from "@frontend/app/navigation/types";
import { type AppNavigationContextValue, AppNavigationContext } from "./navigation-context";

type AppNavigationProviderProps = {
  selected_route: RouteId;
  navigate_to_route: (route_id: RouteId) => void;
  children: ReactNode;
};

/** 壳层提供当前路由，Provider 保留跨页面的一次性查找意图。 */
export function AppNavigationProvider(props: AppNavigationProviderProps): JSX.Element {
  const [proofreading_lookup_intent, set_proofreading_lookup_intent] =
    useState<ProofreadingLookupIntent | null>(null);

  const value = useMemo<AppNavigationContextValue>(() => {
    return {
      selected_route: props.selected_route,
      navigate_to_route: props.navigate_to_route,
      proofreading_lookup_intent,
      push_proofreading_lookup_intent: set_proofreading_lookup_intent,
      clear_proofreading_lookup_intent: () => {
        set_proofreading_lookup_intent(null);
      },
    };
  }, [proofreading_lookup_intent, props.navigate_to_route, props.selected_route]);

  return (
    <AppNavigationContext.Provider value={value}>{props.children}</AppNavigationContext.Provider>
  );
}
