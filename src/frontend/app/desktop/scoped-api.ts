import { api_blob, api_fetch, api_get, api_upload } from "./desktop-api";

/** 工程请求使用发起页面绑定的身份。 */
export function createProjectFetch(projectId: string | undefined): typeof api_fetch {
  return (...args) => {
    if (projectId === undefined) return api_fetch(...args);
    const [route, body, ...options] = args;
    return api_fetch(route, { ...body, projectId }, ...options);
  };
}

/** 对话请求只按工程打开周期路由。 */
export function createAgentApi(projectId?: string) {
  const scoped_path = (route: string) => {
    if (projectId === undefined) return route;
    const [path, search] = route.split("?", 2);
    const query = new URLSearchParams(search);
    query.set("projectId", projectId);
    return path + "?" + query.toString();
  };
  const post = createProjectFetch(projectId);
  const get: typeof api_get = (route) => api_get(scoped_path(route));
  const blob: typeof api_blob = (...[route, ...options]) =>
    api_blob(scoped_path(route), ...options);
  const upload: typeof api_upload = (...[route, file, ...options]) =>
    api_upload(scoped_path(route), file, ...options);
  return { post, get, blob, upload };
}
