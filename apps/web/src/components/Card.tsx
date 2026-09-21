import type { ReactNode } from 'react'

export default function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card glass">
      <h2 className="lbl">{title}</h2>
      {children}
    </section>
  )
}
