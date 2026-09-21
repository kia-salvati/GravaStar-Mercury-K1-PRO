export const THEMES = ['system', 'white', 'dark', 'black'] as const
export type Theme = (typeof THEMES)[number]
/** What the stylesheet actually paints: `system` resolves to one of these. */
export type ResolvedTheme = Exclude<Theme, 'system'>

export const FIELDS = ['ambient', 'static'] as const
export type Field = (typeof FIELDS)[number]

export const THEME_LABELS: Record<Theme, string> = { system: 'Follow system', white: 'White', dark: 'Dark', black: 'Black' }
export const FIELD_LABELS: Record<Field, string> = { ambient: 'Ambient', static: 'Static' }

export const STORAGE_KEYS = { theme: 'k1.theme', field: 'k1.field' } as const
