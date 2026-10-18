import type { TraceEvent } from './types';

const NAME: Record<string, string> = { user: 'User', agent: 'Agent', gateway: 'Gateway', tool: 'Tool', ledger: 'Store' };

interface Props {
  events: TraceEvent[];
  starts: number[];
  durs: number[];
  total: number;
  active: number;
  onPick: (i: number) => void;
}

export function Waterfall({ events, starts, durs, total, active, onPick }: Props) {
  return (
    <ol className="waterfall" aria-label="Trace of every step">
      {events.map((e, i) => (
        <li key={e.id}>
          <button type="button" className={`wf-row ${i === active ? 'active' : ''} ${i > active ? 'future' : ''}`} onClick={() => onPick(i)}>
            <span className="wf-name">
              <span className={`dot ${e.status}`} />
              <span className="wf-path">{e.src === e.dst ? NAME[e.src] : `${NAME[e.src]} → ${NAME[e.dst]}`}</span>
              <span className="wf-label">{e.label}</span>
            </span>
            <span className="wf-track" aria-hidden="true">
              <span className={`wf-bar ${e.status}`} style={{ left: `${(starts[i] / total) * 100}%`, width: `max(4px, ${(durs[i] / total) * 100}%)` }} />
            </span>
            <span className="wf-ms">{e.dur >= 1000 ? `${(e.dur / 1000).toFixed(1)} s` : `${e.dur} ms`}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
