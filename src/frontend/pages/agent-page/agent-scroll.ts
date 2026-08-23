const AGENT_SCROLL_END_TOLERANCE_PX = 2;

/** 小幅容忍浏览器的亚像素舍入，滚动状态只服从容器的真实几何值。 */
export function is_at_scroll_end(target: HTMLElement): boolean {
  return (
    target.scrollHeight - target.scrollTop - target.clientHeight <= AGENT_SCROLL_END_TOLERANCE_PX
  );
}
