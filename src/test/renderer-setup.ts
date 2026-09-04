import { afterEach } from "vitest";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof Element !== "undefined" && Element.prototype.getAnimations === undefined) {
  Element.prototype.getAnimations = () => [];
}

afterEach(() => {
  if (typeof document === "undefined") {
    return;
  }
  document.body.innerHTML = "";
});
