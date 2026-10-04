import type { AgentFile } from "@shared/agent-workspace-file";
import { createContext } from "react";

/** 只把页面动作交给正文链接，文档列表和正文不会穿过时间线传播。 */
export const AgentFileContext = createContext<{
  open_file: (href: string, file: AgentFile) => void;
  chat_id: string;
  active: boolean;
} | null>(null);

export const AgentMarkdownPathContext = createContext("");
