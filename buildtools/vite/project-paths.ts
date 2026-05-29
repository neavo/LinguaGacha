import path from "node:path";
import { fileURLToPath } from "node:url";

export const project_root = fileURLToPath(new URL("../..", import.meta.url));

export function project_path(...segments: string[]): string {
  return path.resolve(project_root, ...segments);
}

export const frontend_resolve_alias = {
  "@frontend": project_path("src/frontend"),
  "@domain": project_path("src/domain"),
  "@backend/api/api-base-url": project_path("src/backend/api/api-base-url.ts"),
  "@gui/bridge-api": project_path("src/gui/bridge/bridge-api.ts"),
  "@gui/bridge-types": project_path("src/gui/bridge/bridge-types.ts"),
  "@gui/external-url-policy": project_path("src/gui/shell/external-url-policy.ts"),
  "@gui/ipc-contract": project_path("src/gui/gui-ipc-contract.ts"),
  "@gui/shell-contract": project_path("src/gui/shell/shell-contract.ts"),
  "@shared": project_path("src/shared"),
} as const;
