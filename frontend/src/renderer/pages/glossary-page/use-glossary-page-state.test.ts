import { describe, expect, it } from 'vitest'

import { buildGlossaryStatisticsState } from './use-glossary-page-state'

describe('buildGlossaryStatisticsState', () => {
  it('把统计结果映射成按条目索引的状态', () => {
    const state = buildGlossaryStatisticsState({
      revision: 3,
      completed_entry_ids: ['苹果|1'],
      results: {
        '苹果|1': {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    })

    expect(state.completed_revision).toBe(3)
    expect(state.matched_count_by_entry_id['苹果|1']).toBe(1)
  })
})
