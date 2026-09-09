import type { AgentPendingDecision, AgentWriteApprovalDecision } from "@shared/agent";

export const AGENT_DECISION_TIMEOUT_MS = 5 * 60 * 1_000;
export const AGENT_QUESTION_DEFAULT_OPTION_INDEX = 0;
export const AGENT_WRITE_APPROVAL_DEFAULT = "allow_once" satisfies AgentWriteApprovalDecision;
const COUNTDOWN_REFRESH_MS = 1_000;

export type AgentDecisionCountdownSnapshot = Readonly<{
  id: string;
  remainingSeconds: number;
  remainingPercent: number;
  paused: boolean;
}> | null;

/** Store 持有的单个决策时钟；页面、Tooltip 与自动提交共用同一时间来源。 */
export class AgentDecisionCountdown {
  private decision: AgentPendingDecision | null = null;
  private remaining_ms = AGENT_DECISION_TIMEOUT_MS; // 暂停时的精确余量，运行时由 deadline 结算
  private deadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private available = false;
  private focused = false;
  private stopped = false; // 保留当前问题身份，阻止提交后的快照或失焦重新启动计时
  private snapshot: AgentDecisionCountdownSnapshot = null;
  private readonly on_change: () => void;
  private readonly on_expire: (decision: AgentPendingDecision) => void;

  /** 仅连接展示通知和到期动作，计时策略固定由当前业务拥有。 */
  public constructor(on_change: () => void, on_expire: (decision: AgentPendingDecision) => void) {
    this.on_change = on_change;
    this.on_expire = on_expire;
  }

  /** 返回缓存快照，满足 React 外部订阅的引用稳定要求。 */
  public readonly read = (): AgentDecisionCountdownSnapshot => this.snapshot;

  /** 同一问题的快照恢复保留剩余时间；新问题从完整期限开始。 */
  public sync(decision: AgentPendingDecision | null, available: boolean): void {
    this.freeze();
    if (decision?.id !== this.decision?.id || decision?.kind !== this.decision?.kind) {
      this.remaining_ms = AGENT_DECISION_TIMEOUT_MS;
      this.focused = false;
      this.stopped = false;
    }
    this.decision = decision;
    this.available = available;
    this.resume();
  }

  /** 焦点回调携带问题身份，离场组件的清理不能影响后续问题。 */
  public set_focused(id: string, focused: boolean): void {
    if (this.decision?.kind !== "question" || this.decision.id !== id) return;
    this.freeze();
    this.focused = focused;
    this.resume();
  }

  /** 提交一旦受理就结束自动选择；失败后保留问题，交给用户手动重试。 */
  public stop(id: string): void {
    if (this.decision?.id !== id) return;
    this.freeze();
    this.stopped = true;
    this.publish();
  }

  /** 暂停和重排共用毫秒结算，避免刷新频率影响实际期限。 */
  private freeze(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.deadline !== null) this.remaining_ms = Math.max(0, this.deadline - Date.now());
    this.deadline = null;
  }

  /** 可交互且输入未聚焦时安排下一帧，其余状态仅发布暂停展示。 */
  private resume(): void {
    if (this.decision !== null && !this.stopped && this.available && !this.focused) {
      this.deadline = Date.now() + this.remaining_ms;
      // 即使剩余时间为零也异步裁决，失焦处理不会同步抢先提交默认答案。
      this.timer = setTimeout(this.tick, Math.min(COUNTDOWN_REFRESH_MS, this.remaining_ms));
    }
    this.publish();
  }

  /** 先关闭到期问题的自动选择，再通知宿主提交。 */
  private readonly tick = (): void => {
    this.freeze();
    const decision = this.decision;
    if (decision !== null && this.remaining_ms === 0) {
      this.stop(decision.id);
      this.on_expire(decision);
    } else {
      this.resume();
    }
  };

  /** 同一时刻的重复状态不触发渲染，Tooltip 与进度环共用这份投影。 */
  private publish(): void {
    const next: AgentDecisionCountdownSnapshot =
      this.decision === null || this.stopped
        ? null
        : {
            id: this.decision.id,
            remainingSeconds: Math.ceil(this.remaining_ms / 1_000),
            remainingPercent: (this.remaining_ms / AGENT_DECISION_TIMEOUT_MS) * 100,
            paused: this.focused || !this.available,
          };
    if (
      next?.id === this.snapshot?.id &&
      next?.remainingSeconds === this.snapshot?.remainingSeconds &&
      next?.remainingPercent === this.snapshot?.remainingPercent &&
      next?.paused === this.snapshot?.paused
    )
      return;
    this.snapshot = next;
    this.on_change();
  }
}
