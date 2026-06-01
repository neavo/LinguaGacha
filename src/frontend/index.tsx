import React from "react";
import ReactDOM from "react-dom/client";
import App from "@frontend/app";
import { RendererErrorBoundary } from "@frontend/app/diagnostics/renderer-error-boundary";
import { install_renderer_global_error_handlers } from "@frontend/app/diagnostics/renderer-error-reporter";
import "@frontend/index.css";

install_renderer_global_error_handlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>,
);
