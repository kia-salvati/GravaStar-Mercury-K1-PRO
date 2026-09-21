/** A stage shown as discrete blocks, the way the keyboard itself counts it. */
export default function Steps({ label, value, min, max }: { label: string; value: number; min: number; max: number }) {
  const stages = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <span className="steps" role="img" aria-label={`${label} ${value} of ${min}–${max}`}>
      {stages.map((stage) => <i key={stage} className={stage <= value ? 'on' : undefined} />)}
      <b>{value}</b>
    </span>
  )
}
