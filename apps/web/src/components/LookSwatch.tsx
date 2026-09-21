import { colourKind } from '../utils/colour'
import type { Look } from '../utils/look'
import KeyGrid from './KeyGrid'
import Swatch from './Swatch'

/** A look's swatch: the per-key grid when the colours are known, otherwise the plain swatch by kind. */
export default function LookSwatch({ look, grid = 'sm' }: { look: Look; grid?: 'sm' | 'md' }) {
  if (look.keys) return <KeyGrid keys={look.keys} size={grid} />
  return <Swatch kind={colourKind(look)} hex={look.colourHex} />
}
