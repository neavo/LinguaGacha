import { useMemo, useState, type ReactNode } from "react";
import type {
  AgentInputRequest,
  ProofreadingLookupIntent,
  RouteId,
} from "@frontend/app/navigation/types";
import { type AppNavigationContextValue, AppNavigationContext } from "./navigation-context";

type AppNavigationProviderProps = {
  selected_route: RouteId;
  navigate_to_route: (route_id: RouteId, request?: AgentInputRequest) => void;
  agent_input_request: AgentInputRequest | null;
  clear_agent_input_request: () => void;
  children: ReactNode;
};

/** 壳层共同提交路由与 Agent 输入请求，Provider 暴露专用入口并保留校对查找意图。 */
export function AppNavigationProvider(props: AppNavigationProviderProps): JSX.Element {
  const [proofreading_lookup_intent, set_proofreading_lookup_intent] =
    useState<ProofreadingLookupIntent | null>(null);

  const value = useMemo<AppNavigationContextValue>(() => {
    return {
      selected_route: props.selected_route,
      agent_input_request: props.agent_input_request,
      clear_agent_input_request: props.clear_agent_input_request,
      navigate_to_agent: (request) => props.navigate_to_route("agent", request),
      navigate_to_route: props.navigate_to_route,
      proofreading_lookup_intent,
      push_proofreading_lookup_intent: set_proofreading_lookup_intent,
      clear_proofreading_lookup_intent: () => {
        set_proofreading_lookup_intent(null);
      },
    };
  }, [
    proofreading_lookup_intent,
    props.navigate_to_route,
    props.selected_route,
    props.agent_input_request,
    props.clear_agent_input_request,
  ]);

  return (
    <AppNavigationContext.Provider value={value}>{props.children}</AppNavigationContext.Provider>
  );
}
