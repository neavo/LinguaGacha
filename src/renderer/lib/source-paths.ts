export function normalize_source_paths(source_paths: string[]): string[] {
  return Array.from(
    new Set(
      source_paths
        .map((source_path) => source_path.trim())
        .filter((source_path) => source_path !== ""),
    ),
  );
}
