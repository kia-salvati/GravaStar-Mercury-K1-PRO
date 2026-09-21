/** 126 per-key colours as a 14-column grid, the shape of the K1 PRO's matrix. */
export default function KeyGrid({ keys, size }: { keys: string[]; size: 'sm' | 'md' }) {
  return (
    <span className={`keygrid ${size}`} role="img" aria-label="per-key colours">
      {keys.map((hex, slot) => <i key={slot} style={{ background: hex }} />)}
    </span>
  )
}
