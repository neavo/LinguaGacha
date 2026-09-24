import { createContext, useContext } from "react";
import type {
  AgentInputRequest,
  ProofreadingLookupIntent,
  RouteId,
} from "@frontend/app/navigation/types";

export type AppNavigationContextValue = {
  selected_route: RouteId;
  agent_input_request: AgentInputRequest | null;
  navigate_to_agent: (request: AgentInputRequest) => void;
  clear_agent_input_request: () => void;
  navigate_to_route: (route_id: RouteId) => void;
  proofreading_lookup_intent: ProofreadingLookupIntent | null;
  push_proofreading_lookup_intent: (intent: ProofreadingLookupIntent) => void;
  clear_proofreading_lookup_intent: () => void;
};

export const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

/** 页面通过共享导航入口提交路由、Agent 输入请求与校对查找意图。 */
export function useAppNavigation(): AppNavigationContextValue {
  const value = useContext(AppNavigationContext);
  if (value === null) {
    throw new Error("useAppNavigation must be used inside AppNavigationProvider");
  }

  return value;
}
