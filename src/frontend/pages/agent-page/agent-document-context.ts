import { createContext } from "react";

/** 只把页面动作交给正文链接，文档列表和正文不会穿过时间线传播。 */
export const AgentDocumentContext = createContext<{
  open_document: (href: string) => Promise<void>;
  session_id: string;
  active: boolean;
} | null>(null);

export const AgentMarkdownPathContext = createContext("");
