import { Component, type ErrorInfo, type ReactNode } from "react";
import { create_text_resolver, type Locale } from "@shared/i18n";

import { capture_renderer_error } from "@frontend/app/diagnostics/renderer-error-reporter";
import "./renderer-error-boundary.css";

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  has_error: boolean;
};

/**
 * 应用根错误边界只负责兜住 React 渲染异常，具体诊断写入统一交给 renderer error reporter。
 */
export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  // 构造阶段只注入必要依赖，避免实例创建时读取外部可变状态。
  public constructor(props: RendererErrorBoundaryProps) {
    super(props);
    this.state = { has_error: false };
  }

  /**
   * 组件栈只作为诊断上下文写日志，不暴露到用户界面。
   */
  public componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ has_error: true });
    capture_renderer_error(error, {
      source: "render",
      context: {
        componentStack: info.componentStack,
      },
    });
  }

  // render 是跨边界副作用入口，集中处理调用时序和错误载荷组装。
  public render(): ReactNode {
    if (!this.state.has_error) {
      return this.props.children;
    }

    const text = create_text_resolver(read_error_boundary_locale());
    return (
      <main className="renderer-error-boundary" role="alert">
        <section className="renderer-error-boundary__panel">
          <p className="renderer-error-boundary__eyebrow">{text("app.error_boundary.eyebrow")}</p>
          <h1 className="renderer-error-boundary__title">{text("app.error_boundary.title")}</h1>
          <p className="renderer-error-boundary__description">
            {text("app.error_boundary.description")}
          </p>
        </section>
      </main>
    );
  }
}

// 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_error_boundary_locale(): Locale {
  const language = window.navigator.language.trim().toUpperCase();
  return language === "EN" || language.startsWith("EN-") ? "en-US" : "zh-CN";
}
