import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AgentPendingDecision } from "@shared/agent";
import type { AgentComposerHandle } from "./agent-composer";

const ENTER_DURATION_MS = 400;
const EXIT_DURATION_MS = 300;
const REDUCED_DURATION_MS = 100;
const CONTENT_SWITCH_OFFSET = 0.45;
const STATUS_HIDE_OFFSET = 0.2;
const INPUT_TRANSITION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

type AgentInputTransition = Readonly<{
  region_ref: RefObject<HTMLDivElement | null>;
  area_ref: RefObject<HTMLDivElement | null>;
  status_ref: RefObject<HTMLDivElement | null>;
  composer_slot_ref: RefObject<HTMLDivElement | null>;
  decision_ref: RefObject<HTMLDivElement | null>;
  title_ref: RefObject<HTMLHeadingElement | null>;
  visible_decision: AgentPendingDecision | null;
  locked: boolean;
}>;

/** 底部区域统一拥有占位与内部展开动画；会话事实仍直接消费 pendingDecision。 */
export function useAgentInputTransition(
  decision: AgentPendingDecision | null,
  composer: RefObject<AgentComposerHandle | null>,
): AgentInputTransition {
  const region_ref = useRef<HTMLDivElement>(null);
  const area_ref = useRef<HTMLDivElement>(null);
  const status_ref = useRef<HTMLDivElement>(null);
  const composer_slot_ref = useRef<HTMLDivElement>(null);
  const decision_ref = useRef<HTMLDivElement>(null);
  const title_ref = useRef<HTMLHeadingElement>(null);
  // 离场期间保留内容与输入锁；完成后释放，避免隐藏的倒计时继续运行。
  const [retained_decision, set_retained_decision] = useState(decision);
  const animations_ref = useRef<Animation[]>([]); // 当前过渡统一登记和回收的动画
  const initialized_ref = useRef(false); // 首次挂载与 StrictMode 重放直接恢复布局
  const restore_focus_ref = useRef(false); // 离场区域请求在输入恢复后归还焦点

  useLayoutEffect(() => {
    const region = region_ref.current;
    const area = area_ref.current;
    const status = status_ref.current;
    const composer_slot = composer_slot_ref.current;
    const panel = decision_ref.current;
    if (!region || !area || !status || !composer_slot || !panel) return;

    const opening = decision !== null;
    const active = document.activeElement;
    const focus_in_input =
      active !== null && (composer_slot.contains(active) || status.contains(active));
    const focus_in_panel = active !== null && panel.contains(active);
    if (opening) {
      set_retained_decision(decision);
      restore_focus_ref.current = false;
    } else if (focus_in_panel) {
      restore_focus_ref.current = true;
    }

    const continuing = opening && region.dataset.decision === "true";
    /** 读取当前实际占位，供中断接续与目标尺寸计算共用。 */
    const measure = () => ({
      region: region.getBoundingClientRect().height,
      width: area.getBoundingClientRect().width,
      status: status.getBoundingClientRect().height,
      input: composer_slot.getBoundingClientRect().height,
      panel: panel.getBoundingClientRect().height,
    });
    // 中断时先读取屏幕上的实际尺寸，再撤销旧动画，下一段由当前位置接续。
    const start = measure();
    const start_opacity = [status, composer_slot, panel].map(
      (element) => getComputedStyle(element).opacity,
    );
    // 测量目标内容时固定外部占位，防止临时放大滚动视口而提前夹取 scrollTop。
    region.style.height = `${start.region}px`;
    cancel_animations(animations_ref.current);
    region.dataset.decision = String(opening);
    const end = measure();
    const region_style = getComputedStyle(region);
    end.region =
      area.getBoundingClientRect().height +
      Number.parseFloat(region_style.paddingTop) +
      Number.parseFloat(region_style.paddingBottom);

    /** 解除临时尺寸并回收整段动画，离场完成后释放决定内容与输入锁。 */
    const finish = (): void => {
      region.style.removeProperty("height");
      cancel_animations(animations_ref.current);
      delete region.dataset.transitioning;
      window.removeEventListener("resize", finish);
      if (!opening) {
        set_retained_decision(null);
      }
    };

    if (opening && focus_in_input) {
      title_ref.current?.focus({ preventScroll: true });
    }
    // 首次恢复和未参与布局的页面直接呈现稳定状态。
    if (!initialized_ref.current || start.region === 0) {
      initialized_ref.current = true;
      finish();
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? REDUCED_DURATION_MS : opening ? ENTER_DURATION_MS : EXIT_DURATION_MS;
    /** 登记原生动画，使完成、中断与卸载共用同一回收入口。 */
    const animate = (element: HTMLElement, frames: Keyframe[]): Animation => {
      const animation = element.animate(frames, { duration, fill: "both" });
      animations_ref.current.push(animation);
      return animation;
    };
    // 窗口尺寸变化时结束当前过渡，让自然布局立即采用新的可用空间。
    window.addEventListener("resize", finish);
    /** 依赖更新或卸载时解除本段过渡的窗口监听。 */
    const stop_observing = (): void => window.removeEventListener("resize", finish);
    if (reduced) {
      region.style.removeProperty("height");
      animate(area, [{ opacity: 0.7 }, { opacity: 1 }]).onfinish = finish;
      return stop_observing;
    }

    region.dataset.transitioning = "true";
    animate(area, [
      { width: `${start.width}px`, offset: 0, easing: INPUT_TRANSITION_EASING },
      ...(continuing
        ? []
        : [
            {
              width: `${opening ? end.width : start.width}px`,
              offset: CONTENT_SWITCH_OFFSET,
              easing: INPUT_TRANSITION_EASING,
            },
          ]),
      { width: `${end.width}px`, offset: 1 },
    ]);
    // 状态区和输入器先收拢，选择框随后展开；连续决定直接过渡到新尺寸。
    for (const [element, from, to, opacity, split] of [
      [
        status,
        start.status,
        end.status,
        start_opacity[0],
        opening ? STATUS_HIDE_OFFSET : CONTENT_SWITCH_OFFSET,
      ],
      [composer_slot, start.input, end.input, start_opacity[1], CONTENT_SWITCH_OFFSET],
      [panel, start.panel, end.panel, start_opacity[2], CONTENT_SWITCH_OFFSET],
    ] as const) {
      const visible = element === panel ? opening : !opening;
      animate(element, [
        {
          height: `${from}px`,
          opacity,
          visibility: "visible",
          offset: 0,
          easing: INPUT_TRANSITION_EASING,
        },
        ...(continuing
          ? []
          : [
              {
                height: `${element === panel || opening ? 0 : from}px`,
                opacity: 0,
                visibility: "visible",
                offset: split,
                easing: INPUT_TRANSITION_EASING,
              },
            ]),
        {
          height: `${to}px`,
          opacity: visible ? 1 : 0,
          visibility: "visible",
          offset: 1,
        },
      ]);
    }
    // 总占位独立插值，吸收收拢与展开之间的空隙；信息流始终消费真实布局高度。
    animate(region, [
      { height: `${start.region}px`, easing: INPUT_TRANSITION_EASING },
      { height: `${end.region}px` },
    ]).onfinish = finish;
    return stop_observing;
  }, [decision, composer]);

  useEffect(() => {
    if (decision !== null || retained_decision !== null || !restore_focus_ref.current) return;
    // 等 Composer 同步 CodeMirror 的可编辑属性后恢复焦点，阅读区的新焦点优先。
    if (
      document.activeElement === document.body ||
      decision_ref.current?.contains(document.activeElement)
    ) {
      composer.current?.focus();
    }
    restore_focus_ref.current = false;
  }, [decision, retained_decision, composer]);

  useLayoutEffect(
    () => () => {
      initialized_ref.current = false;
      cancel_animations(animations_ref.current);
    },
    [],
  );

  return {
    region_ref,
    area_ref,
    status_ref,
    composer_slot_ref,
    decision_ref,
    title_ref,
    visible_decision: decision ?? retained_decision,
    locked: decision !== null || retained_decision !== null,
  };
}

/** 先解除完成回调再撤销动画，完成、中断与卸载共用同一资源清理。 */
function cancel_animations(animations: Animation[]): void {
  for (const animation of animations) {
    animation.onfinish = null;
    animation.cancel();
  }
  animations.length = 0;
}
