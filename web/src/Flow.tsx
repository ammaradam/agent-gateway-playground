import type { Lane, Status, TraceEvent } from './types';

const W = 960;
const Y = 128;
const NODE_W = 132;
const NODE_H = 78;

const NODES: Record<Lane, { x: number; title: string; sub: string }> = {
  user: { x: 84, title: 'User', sub: 'asks' },
  agent: { x: 276, title: 'Agent', sub: 'Microsoft Agent Framework' },
  gateway: { x: 486, title: 'Gateway', sub: 'policy · idempotency' },
  tool: { x: 696, title: 'Tool', sub: 'tickets · records' },
  ledger: { x: 880, title: 'Store', sub: 'in memory' },
};
const ORDER: Lane[] = ['user', 'agent', 'gateway', 'tool', 'ledger'];
const EDGES: [Lane, Lane][] = [['user', 'agent'], ['agent', 'gateway'], ['gateway', 'tool'], ['tool', 'ledger']];

const COLOR: Record<Status, string> = { ok: 'var(--blue)', warn: 'var(--amber)', error: 'var(--red)' };

function packetAt(src: Lane, dst: Lane, p: number) {
  const x0 = NODES[src].x, x1 = NODES[dst].x;
  const gap = Math.abs(ORDER.indexOf(src) - ORDER.indexOf(dst));
  if (gap > 1) { // arc over the nodes in between
    const cx = (x0 + x1) / 2, cy = Y - 96;
    const a = (1 - p) * (1 - p), b = 2 * (1 - p) * p, c = p * p;
    return { x: a * x0 + b * cx + c * x1, y: a * Y + b * cy + c * Y };
  }
  return { x: x0 + (x1 - x0) * p, y: Y };
}

function arcPath(a: Lane, b: Lane) {
  const x0 = NODES[a].x, x1 = NODES[b].x;
  return `M ${x0} ${Y} Q ${(x0 + x1) / 2} ${Y - 192} ${x1} ${Y}`;
}

interface Props {
  events: TraceEvent[];
  active: number; // index of the current event, -1 before start
  progress: number; // 0..1 inside the current event
  reduced: boolean;
}

export function Flow({ events, active, progress, reduced }: Props) {
  const ev = active >= 0 ? events[active] : null;
  const p = reduced ? 1 : progress;
  const moving = ev && ev.src !== ev.dst;
  const pos = ev && moving ? packetAt(ev.src, ev.dst, p) : null;

  // The store: rows that exist from the start (deleted later) and rows written so far.
  const seen = events.slice(0, active + 1);
  const rows: { text: string; gone?: boolean }[] = [];
  events.filter(e => e.kind === 'ledger.delete').forEach(e => {
    rows.push({ text: `${e.label} · Q3 customer export`, gone: seen.some(s => s.id === e.id) });
  });
  seen.filter(e => e.kind === 'ledger.write').forEach(e => {
    const project = /project (\w+)/.exec(e.detail)?.[1];
    rows.push({ text: `${e.label}${project ? ` · ${project}` : ''}` });
  });

  const hint = seen.filter(e => e.kind.startsWith('idempotency')).slice(-1)[0];
  const touched = (l: Lane) => ev && (ev.src === l || ev.dst === l);
  const lit = (l: Lane): string | undefined => (touched(l) && (p < 1 || ev!.src === ev!.dst) ? COLOR[ev!.status] : undefined);

  return (
    <svg viewBox={`0 0 ${W} 300`} role="img" className="flow"
      aria-label="Flow diagram: the user asks the agent, the agent calls the gateway, the gateway calls the tool, and the tool writes to the store.">
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>

      {EDGES.map(([a, b]) => (
        <line key={a + b} x1={NODES[a].x + NODE_W / 2} y1={Y} x2={NODES[b].x - NODE_W / 2} y2={Y} className="edge" />
      ))}
      {ev && ev.src !== ev.dst && Math.abs(ORDER.indexOf(ev.src) - ORDER.indexOf(ev.dst)) > 1 && (
        <path d={arcPath(ev.src, ev.dst)} className="edge arc" style={{ stroke: COLOR[ev.status] }} />
      )}
      {ev && moving && Math.abs(ORDER.indexOf(ev.src) - ORDER.indexOf(ev.dst)) === 1 && (
        <line x1={NODES[ev.src].x} y1={Y} x2={NODES[ev.dst].x} y2={Y} className="edge on" style={{ stroke: COLOR[ev.status] }} />
      )}

      {ORDER.map(l => {
        const n = NODES[l];
        const c = lit(l);
        return (
          <g key={l} transform={`translate(${n.x - NODE_W / 2} ${Y - NODE_H / 2})`}>
            {c && <rect width={NODE_W} height={NODE_H} rx="18" fill={c} opacity=".35" filter="url(#glow)" />}
            <rect width={NODE_W} height={NODE_H} rx="18" className="node" style={c ? { stroke: c, strokeWidth: 2 } : undefined} />
            <text x={NODE_W / 2} y={34} textAnchor="middle" className="node-title">{n.title}</text>
            <text x={NODE_W / 2} y={55} textAnchor="middle" className="node-sub">{n.sub}</text>
          </g>
        );
      })}

      {/* the store's contents */}
      <g transform={`translate(${NODES.ledger.x - NODE_W / 2} ${Y + NODE_H / 2 + 14})`}>
        {rows.slice(-4).map((r, i) => (
          <g key={r.text + i} transform={`translate(0 ${i * 22})`}>
            <rect width={NODE_W} height="18" rx="9" className={r.gone ? 'row gone' : 'row'} />
            <text x="9" y="13" className={r.gone ? 'row-text gone' : 'row-text'}>{r.text.length > 20 ? r.text.slice(0, 19) + '…' : r.text}</text>
          </g>
        ))}
      </g>
      {hint && (
        <text x={NODES.gateway.x} y={Y + NODE_H / 2 + 26} textAnchor="middle" className="hint">{hint.label}</text>
      )}

      {/* a packet in flight */}
      {ev && pos && (
        <g transform={`translate(${pos.x} ${pos.y})`}>
          <circle r="16" fill={COLOR[ev.status]} opacity=".25" />
          <circle r="7" fill={COLOR[ev.status]} />
          <Chip text={ev.label} color={COLOR[ev.status]} y={-30} />
        </g>
      )}
      {/* a step that happens inside one node */}
      {ev && !moving && (
        <g transform={`translate(${NODES[ev.src].x} ${Y})`}>
          <rect x={-NODE_W / 2 - 6} y={-NODE_H / 2 - 6} width={NODE_W + 12} height={NODE_H + 12} rx="22" fill="none"
            stroke={COLOR[ev.status]} strokeWidth="2" opacity={reduced ? 0.8 : 1 - p * 0.7} />
          <Chip text={ev.label} color={COLOR[ev.status]} y={-NODE_H / 2 - 22} />
        </g>
      )}
    </svg>
  );
}

function Chip({ text, color, y }: { text: string; color: string; y: number }) {
  const w = Math.max(54, text.length * 7.2 + 20);
  return (
    <g transform={`translate(0 ${y})`}>
      <rect x={-w / 2} y={-13} width={w} height={26} rx="13" fill={color} />
      <text textAnchor="middle" y="5" className="chip-text">{text}</text>
    </g>
  );
}
