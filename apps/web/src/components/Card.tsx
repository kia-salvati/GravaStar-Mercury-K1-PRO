import type { ReactNode } from 'react'

/** `future`: a dashed, unfilled card that marks where something will go. */
export default function Card({ title, future = false, children }: { title: string; future?: boolean; children: ReactNode }) {
  return (
    <section className={future ? 'card glass future' : 'card glass'}>
      <h2 className="lbl">{title}</h2>
      {children}
    </section>
  )
}
