import Card from '../components/Card'

/** Lighting, Keys and Macros: a route each, and one honest panel until Stage 2 builds them. */
export default function StagePage({ title }: { title: string }) {
  return (
    <>
      <header className="panel-head">
        <strong>{title}</strong>
      </header>
      <Card title="Stage 2">
        <p className="stmt">Not built yet</p>
        <p className="help">Stage 1 only reads the keyboard. {title} controls arrive in Stage 2; until then nothing in this app can change the keyboard.</p>
      </Card>
    </>
  )
}
