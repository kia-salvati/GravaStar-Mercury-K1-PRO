interface Props<T extends string> {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
}

export default function Segmented<T extends string>({ label, options, labels, value, onChange }: Props<T>) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={option === value} onClick={() => onChange(option)}>
          {labels[option]}
        </button>
      ))}
    </div>
  )
}
