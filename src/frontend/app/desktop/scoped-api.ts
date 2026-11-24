import { createContext, useContext } from "react";
import { api_blob, api_fetch, api_file_url, api_get, api_upload } from "./desktop-api";

export type ChatScope = Readonly<{ projectId: string; chatId: string }>;

/** 工程请求使用发起页面绑定的身份。 */
export function createProjectFetch(projectId: string | undefined): typeof api_fetch {
  return (...[route, body, ...options]) =>
    api_fetch(route, projectId === undefined ? body : { ...body, projectId }, ...options);
}

/** 对话路由在 JSON 请求体或查询参数中携带同一组身份。 */
export function createAgentApi(scope?: ChatScope) {
  const scoped_path = (route: string) => {
    if (scope === undefined) return route;
    const [path, search] = route.split("?", 2);
    const query = new URLSearchParams(search);
    query.set("projectId", scope.projectId);
    query.set("chatId", scope.chatId);
    return path + "?" + query.toString();
  };
  const post: typeof api_fetch = (...args) => {
    if (scope === undefined) return api_fetch(...args);
    const [route, body, ...options] = args;
    return api_fetch(route, { ...body, ...scope }, ...options);
  };
  const get: typeof api_get = (route) => api_get(scoped_path(route));
  const blob: typeof api_blob = (...[route, ...options]) =>
    api_blob(scoped_path(route), ...options);
  const upload: typeof api_upload = (...[route, file, ...options]) =>
    api_upload(scoped_path(route), file, ...options);
  return { post, get, blob, upload, url: (route: string) => api_file_url(scoped_path(route)) };
}

const UNSCOPED_AGENT_API = createAgentApi();
export const ChatTransportContext = createContext<{
  scope: ChatScope | undefined;
  api: ReturnType<typeof createAgentApi>;
} | null>(null);
export function useAgentApi() {
  return useContext(ChatTransportContext)?.api ?? UNSCOPED_AGENT_API;
}
export function useAgentScope() {
  return useContext(ChatTransportContext)?.scope;
}
