import type { ReactNode } from "react";

// 保留应用组合层入口；项目事实和页面缓存同步已迁往后端 query。
export function ProjectSessionProvider(props: { children: ReactNode }): JSX.Element {
  return <>{props.children}</>;
}
