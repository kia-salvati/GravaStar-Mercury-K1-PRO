import type { Disconnected } from '../types/keyboard'
import Card from './Card'

const HEADLINE: Record<Disconnected['status'], string> = {
  unsupported: 'WebHID is not available here',
  idle: 'Not connected',
  connecting: 'Reading the keyboard…',
}

export default function ConnectPanel({ status, notice, onConnect }: { status: Disconnected['status']; notice: string | null; onConnect: () => void }) {
  return (
    <Card title="Connection">
      <p className="stmt">{HEADLINE[status]}</p>
      {status === 'unsupported' ? (
        <p className="help">This app reads the keyboard through WebHID, which Chrome and Edge provide. Open it in one of those.</p>
      ) : (
        <p className="help">Plug the keyboard in over USB or its 2.4G dongle, then choose it in the browser prompt. The choice is remembered, so next time the app connects on its own.</p>
      )}
      {notice && <p className="note" role="status">{notice}</p>}
      {status === 'idle' && (
        <p className="actions">
          <button type="button" className="btn" onClick={onConnect}>Connect keyboard</button>
        </p>
      )}
    </Card>
  )
}
