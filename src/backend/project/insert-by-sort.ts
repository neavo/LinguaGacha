/** 相同位置按类型优先级和原始行号稳定插入，`-1` 追加到末尾。 */
export function insert_by_sort<T>(
  kept: T[],
  sorted: { value: T; sort: number; rank: number; line: number }[],
): T[] {
  sorted.sort((left, right) => {
    if (left.sort === -1 && right.sort !== -1) return 1;
    if (right.sort === -1 && left.sort !== -1) return -1;
    return left.sort - right.sort || left.rank - right.rank || left.line - right.line;
  });
  for (let index = 0; index < sorted.length;) {
    const sort = sorted[index]!.sort;
    const group: T[] = [];
    while (index < sorted.length && sorted[index]!.sort === sort) {
      group.push(sorted[index++]!.value);
    }
    kept.splice(sort === -1 ? kept.length : Math.min(sort, kept.length), 0, ...group);
  }
  return kept;
}
