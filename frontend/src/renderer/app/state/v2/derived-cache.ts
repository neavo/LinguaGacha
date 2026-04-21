export class DerivedCache<value_type> {
  private readonly cache = new Map<string, value_type>()

  get(key: string): value_type | undefined {
    return this.cache.get(key)
  }

  set(key: string, value: value_type): void {
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }
}
