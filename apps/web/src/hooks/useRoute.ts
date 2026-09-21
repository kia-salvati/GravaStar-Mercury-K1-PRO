import { useSyncExternalStore } from 'react'
import { routeForHash, type Route } from '../config/routes'

const subscribe = (onChange: () => void) => {
  addEventListener('hashchange', onChange)
  return () => removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => routeForHash(location.hash))
}
