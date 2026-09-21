import type { ColourKind } from '../utils/colour'

const CLASS_BY_KIND: Record<Exclude<ColourKind, 'single'>, string> = { none: 'none', mixed: 'mix', perKey: 'perkey' }

export default function Swatch({ kind, hex }: { kind: ColourKind; hex: string | null }) {
  if (kind !== 'single') return <span className={`swatch ${CLASS_BY_KIND[kind]}`} />
  return hex ? <span className="swatch" style={{ background: hex }} /> : <span className="swatch none" />
}
