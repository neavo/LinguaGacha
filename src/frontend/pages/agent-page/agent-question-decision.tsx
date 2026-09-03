import { useId, useState } from "react";
import { ArrowRight, CircleQuestionMark } from "lucide-react";

import type { AgentPendingDecision, AgentQuestionResponse } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@frontend/shadcn/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import {
  AgentDecisionAction,
  AgentDecisionOverlay,
  useAgentDecisionSubmit,
} from "./agent-decision-overlay";

type QuestionDecision = Extract<AgentPendingDecision, { kind: "question" }>;

/** 普通问题提供即时固定答案、显式自定义答案和取消入口。 */
export function AgentQuestionDecision(props: {
  decision: QuestionDecision;
  on_resolve: (response: AgentQuestionResponse) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const custom_input_id = useId();
  const [custom_text, set_custom_text] = useState("");
  const custom_value = custom_text.trim();
  const resolve = useAgentDecisionSubmit(props.on_resolve);

  return (
    <AgentDecisionOverlay
      title={props.decision.question.prompt}
      TitleIcon={CircleQuestionMark}
      description={props.decision.question.description}
      expires_at={props.decision.expiresAt}
      on_cancel={() => resolve({ kind: "cancel" })}
    >
      {(deadline) => (
        <div className="agent-decision__options">
          {props.decision.question.options.map((option, index) => (
            <AgentDecisionAction
              key={option.id}
              ordinal={index + 1}
              label={option.label}
              deadline={index === 0 ? deadline : undefined}
              on_select={() => resolve({ kind: "option", optionId: option.id })}
            />
          ))}
          <div className="agent-decision-custom">
            <label className="agent-decision-badge" htmlFor={custom_input_id}>
              {t("agent_page.decision.custom")}
            </label>
            <InputGroup className="agent-decision-custom__field">
              <InputGroupInput
                id={custom_input_id}
                value={custom_text}
                placeholder={t("agent_page.decision.custom_placeholder")}
                onChange={(event) => set_custom_text(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        className="agent-decision-icon agent-decision-custom__submit"
                        size="icon-xs"
                        disabled={custom_value === ""}
                        aria-label={t("agent_page.decision.confirm")}
                        onClick={() => {
                          if (custom_value !== "") {
                            resolve({ kind: "custom", text: custom_value });
                          }
                        }}
                      >
                        <ArrowRight aria-hidden="true" />
                      </InputGroupButton>
                    }
                  />
                  <TooltipContent>{t("agent_page.decision.confirm")}</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          </div>
        </div>
      )}
    </AgentDecisionOverlay>
  );
}
