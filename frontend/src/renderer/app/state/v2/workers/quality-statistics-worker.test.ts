import { describe, expect, it } from 'vitest'

import { runQualityStatisticsWorkerTask } from './quality-statistics-worker'

describe('runQualityStatisticsWorkerTask', () => {
  it('返回命中数和包含关系', async () => {
    const result = await runQualityStatisticsWorkerTask({
      rules: [
        {
          key: '苹果|1',
          pattern: '苹果',
          mode: 'glossary',
          case_sensitive: true,
        },
      ],
      srcTexts: ['苹果很好吃', '香蕉一般'],
      dstTexts: [],
    })

    expect(result.results['苹果|1']?.matched_item_count).toBe(1)
  })
})
