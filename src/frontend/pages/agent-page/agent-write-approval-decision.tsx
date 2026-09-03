import { Save } from "lucide-react";

import type {
  AgentPendingDecision,
  AgentPendingWriteSummary,
  AgentWriteApprovalDecision,
} from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  AgentDecisionAction,
  AgentDecisionOverlay,
  useAgentDecisionSubmit,
} from "./agent-decision-overlay";

/** 不会出现在本地化正文中的占位符，用于为数量保留独立视觉语义。 */
const SUMMARY_COUNT_MARKER = "\uE000";

/** 摘要顺序沿用业务数据顺序，零变化类别不进入用户决定。 */
const SUMMARY_FIELDS = [
  ["items", "agent_page.approval.summary.items"],
  ["glossary", "agent_page.approval.summary.glossary"],
  ["textPreserve", "agent_page.approval.summary.text_preserve"],
  ["preReplacement", "agent_page.approval.summary.pre_replacement"],
  ["postReplacement", "agent_page.approval.summary.post_replacement"],
  ["prompts", "agent_page.approval.summary.prompts"],
] as const satisfies readonly (readonly [keyof AgentPendingWriteSummary, LocaleKey])[];

/** 固定顺序同时决定用户看到的风险梯度与提交值。 */
const WRITE_DECISIONS = [
  ["reject", "agent_page.approval.reject"],
  ["allow_once", "agent_page.approval.allow_once"],
  ["allow_session", "agent_page.approval.allow_session"],
] as const satisfies readonly (readonly [AgentWriteApprovalDecision, LocaleKey])[];

type WriteDecision = Extract<AgentPendingDecision, { kind: "write_approval" }>;

/** 写入授权只呈现后端冻结的摘要和三种即时裁决。 */
export function AgentWriteApprovalDecision(props: {
  decision: WriteDecision;
  on_resolve: (decision: AgentWriteApprovalDecision) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const resolve = useAgentDecisionSubmit(props.on_resolve);

  return (
    <AgentDecisionOverlay
      title={t("agent_page.approval.title")}
      TitleIcon={Save}
      description={<AgentWriteSummary summary={props.decision.summary} />}
      expires_at={props.decision.expiresAt}
    >
      {(deadline) => (
        <div className="agent-decision__options">
          {WRITE_DECISIONS.map(([value, key], index) => (
            <AgentDecisionAction
              key={value}
              ordinal={index + 1}
              label={t(key)}
              deadline={index === 0 ? deadline : undefined}
              on_select={() => resolve(value)}
            />
          ))}
        </div>
      )}
    </AgentDecisionOverlay>
  );
}

/** 按当前 locale 投影非零变更类别，不在 renderer 重算写入范围。 */
function AgentWriteSummary(props: { summary: AgentPendingWriteSummary }): JSX.Element {
  const { locale, t } = useI18n();

  return (
    <ul className="agent-write-summary">
      {SUMMARY_FIELDS.filter(([field]) => props.summary[field] > 0).map(([field, key]) => {
        const [before, after] = t(key, { count: SUMMARY_COUNT_MARKER }).split(SUMMARY_COUNT_MARKER);
        return (
          <li key={field} className="agent-write-summary__item">
            {before === "" ? null : <span>{before}</span>}
            <span className="agent-write-summary__value">
              {props.summary[field].toLocaleString(locale)}
            </span>
            {after === "" ? null : <span>{after}</span>}
          </li>
        );
      })}
    </ul>
  );
}
