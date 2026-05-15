import { useCallback, useRef } from "react";

type TerminalPromptSuppressionReason = "manual-stop";

export type TerminalPromptSuppression = {
  clear_terminal_prompt_suppression: () => void;
  consume_terminal_prompt_suppression: () => boolean;
  suppress_next_terminal_prompt: (reason: TerminalPromptSuppressionReason) => void;
};

export function useTerminalPromptSuppression(): TerminalPromptSuppression {
  const suppression_reason_ref = useRef<TerminalPromptSuppressionReason | null>(null);

  const clear_terminal_prompt_suppression = useCallback((): void => {
    suppression_reason_ref.current = null;
  }, []);

  const consume_terminal_prompt_suppression = useCallback((): boolean => {
    if (suppression_reason_ref.current === null) {
      return false;
    }

    suppression_reason_ref.current = null;
    return true;
  }, []);

  const suppress_next_terminal_prompt = useCallback(
    (reason: TerminalPromptSuppressionReason): void => {
      suppression_reason_ref.current = reason;
    },
    [],
  );

  return {
    clear_terminal_prompt_suppression,
    consume_terminal_prompt_suppression,
    suppress_next_terminal_prompt,
  };
}
