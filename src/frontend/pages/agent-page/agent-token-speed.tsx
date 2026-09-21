import {
  useAgentControls,
  useAgentTokenSpeed,
} from "@frontend/app/session/agent/agent-session-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

/** 速度独立订阅，断线或恢复期间隐藏旧值；正文时间线不参与高频更新。 */
export function AgentTokenSpeed(): JSX.Element | null {
  const { tokensPerSecond } = useAgentTokenSpeed();
  const { transport } = useAgentControls();
  const { t } = useI18n();
  if (transport !== "ready" || tokensPerSecond === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="agent-token-speed" tabIndex={0} />}>
        <span className="agent-token-speed__value">{tokensPerSecond.toFixed(2)}</span> T/S
      </TooltipTrigger>
      <TooltipContent>{t("agent_page.token_speed")}</TooltipContent>
    </Tooltip>
  );
}
