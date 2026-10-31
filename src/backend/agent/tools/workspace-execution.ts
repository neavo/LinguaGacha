/** 两个执行工具结算后都刷新技能，刷新失败保留执行主因及完整原因链。 */
export async function execute_and_refresh_skills<T>(
  execute: () => Promise<T>,
  refresh: () => Promise<unknown>,
): Promise<T> {
  const outcome = await execute().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await refresh();
  } catch (error) {
    if (outcome.ok) throw new Error("Agent skill refresh failed.", { cause: error });
    throw new AggregateError(
      [outcome.error, error],
      "Workspace execution and skill refresh failed.",
      { cause: outcome.error },
    );
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
