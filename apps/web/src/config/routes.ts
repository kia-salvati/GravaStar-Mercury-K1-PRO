const ROUTE_NAMES = ['device', 'lighting', 'keys', 'macros', 'settings'] as const

export type Route = (typeof ROUTE_NAMES)[number]

/** Hash routes, so the installed app needs no server-side routing. */
export const ROUTES: Record<Route, string> = {
  device: '#/',
  lighting: '#/lighting',
  keys: '#/keys',
  macros: '#/macros',
  settings: '#/settings',
}

export const ROUTE_LABELS: Record<Route, string> = {
  device: 'Device',
  lighting: 'Lighting',
  keys: 'Keys',
  macros: 'Macros',
  settings: 'Settings',
}

const ROUTE_BY_HASH = new Map<string, Route>(ROUTE_NAMES.map((route) => [ROUTES[route], route]))

export function routeForHash(hash: string): Route {
  return ROUTE_BY_HASH.get(hash) ?? 'device'
}
