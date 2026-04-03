import type { LocaleKey } from '@/i18n'

type ProjectPreviewStat = {
  file_count: number
  created_at: string
  last_updated_at: string
  progress_percent: number
  translated_items: number
  total_items: number
}

export type ProjectRecentProject = {
  id: string
  name: string
  path: string
  preview: ProjectPreviewStat
}

export const project_page_mock = {
  supported_formats: [
    {
      id: 'subtitle-bundle',
      title_key: 'common.project.home.formats.subtitle_bundle' as LocaleKey,
      extensions: '.srt .ass .txt .epub .md',
    },
    {
      id: 'renpy',
      title_key: 'common.project.home.formats.renpy' as LocaleKey,
      extensions: '.rpy',
    },
    {
      id: 'mtool',
      title_key: 'common.project.home.formats.mtool' as LocaleKey,
      extensions: '.json',
    },
    {
      id: 'sextractor',
      title_key: 'common.project.home.formats.sextractor' as LocaleKey,
      extensions: '.txt .json .xlsx',
    },
    {
      id: 'vntextpatch',
      title_key: 'common.project.home.formats.vntextpatch' as LocaleKey,
      extensions: '.json',
    },
    {
      id: 'trans_project',
      title_key: 'common.project.home.formats.trans_project' as LocaleKey,
      extensions: '.trans',
    },
    {
      id: 'trans_export',
      title_key: 'common.project.home.formats.trans_export' as LocaleKey,
      extensions: '.xlsx',
    },
    {
      id: 'wolf',
      title_key: 'common.project.home.formats.wolf' as LocaleKey,
      extensions: '.xlsx',
    },
  ],
  recent_projects: [
    {
      id: 'input-20260403',
      name: 'input_20260403_000400',
      path: 'E:\\Project\\LinguaGacha\\output\\input_20260403_000400.lg',
      preview: {
        file_count: 3,
        created_at: '2026-04-03 00:04:01',
        last_updated_at: '2026-04-03 11:33:39',
        progress_percent: 0,
        translated_items: 0,
        total_items: 245,
      },
    },
  ] satisfies ProjectRecentProject[],
} as const
