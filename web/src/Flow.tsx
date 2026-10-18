import type { Lane, Status, TraceEvent } from './types';

const ORDER: Lane[] = ['user', 'agent', 'gateway', 'tool', 'ledger'];
const META: Record<Lane, { title: string; sub: string }> = {
  user: { title: 'User', sub: 'asks' },
  agent: { title: 'Agent', sub: 'Microsoft Agent Framework' },
  gateway: { title: 'Gateway', sub: 'policy · idempotency' },
  tool: { title: 'Tool', sub: 'tickets · records' },
  ledger: { title: 'Store', sub: 'in memory' },
};
const EDGES: [Lane, Lane][] = [['user', 'agent'], ['agent', 'gateway'], ['gateway', 'tool'], ['tool', 'ledger']];
const COLOR: Record<Status, string> = { ok: 'var(--blue)', warn: 'var(--amber)', error: 'var(--red)' };

interface Layout {
  w: number; h: number; nodeW: number; nodeH: number;
  pos: Record<Lane, { x: number; y: number }>;
  vertical: boolean;
}

const HORIZONTAL: Layout = {
  w: 960, h: 300, nodeW: 132, nodeH: 78, vertical: false,
  pos: { user: { x: 84, y: 128 }, agent: { x: 276, y: 128 }, gateway: { x: 486, y: 128 }, tool: { x: 696, y: 128 }, ledger: { x: 880, y: 128 } },
};
const VERTICAL: Layout = {
  w: 360, h: 560, nodeW: 168, nodeH: 66, vertical: true,
  pos: { user: { x: 104, y: 48 }, agent: { x: 104, y: 160 }, gateway: { x: 104, y: 272 }, tool: { x: 104, y: 384 }, ledger: { x: 104, y: 496 } },
};

const gap = (a: Lane, b: Lane) => Math.abs(ORDER.indexOf(a) - ORDER.indexOf(b));

function packetAt(L: Layout, src: Lane, dst: Lane, p: number) {
  const a = L.pos[src], b = L.pos[dst];
  if (gap(src, dst) > 1) { // arc around the nodes in between
    const c = L.vertical ? { x: a.x + 190, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: a.y - 96 };
    const q0 = (1 - p) * (1 - p), q1 = 2 * (1 - p) * p, q2 = p * p;
    return { x: q0 * a.x + q1 * c.x + q2 * b.x, y: q0 * a.y + q1 * c.y + q2 * b.y };
  }
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

function arcPath(L: Layout, src: Lane, dst: Lane) {
  const a = L.pos[src], b = L.pos[dst];
  const c = L.vertical ? { x: a.x + 380, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: a.y - 192 };
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

interface Props {
  events: TraceEvent[];
  active: number; // index of the current event, -1 before start
  progress: number; // 0..1 inside the current event
  reduced: boolean;
  vertical: boolean;
}

export function Flow({ events, active, progress, reduced, vertical }: Props) {
  const L = vertical ? VERTICAL : HORIZONTAL;
  const ev = active >= 0 ? events[active] : null;
  const p = reduced ? 1 : progress;
  const moving = !!ev && ev.src !== ev.dst;
  const pos = ev && moving ? packetAt(L, ev.src, ev.dst, p) : null;

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

  const touched = (l: Lane) => !!ev && (ev.src === l || ev.dst === l);
  const lit = (l: Lane) => (touched(l) && (p < 1 || !moving) ? COLOR[ev!.status] : undefined);
  const edgeEnds = (a: Lane, b: Lane) => {
    const A = L.pos[a], B = L.pos[b];
    return L.vertical
      ? { x1: A.x, y1: A.y + L.nodeH / 2, x2: B.x, y2: B.y - L.nodeH / 2 }
      : { x1: A.x + L.nodeW / 2, y1: A.y, x2: B.x - L.nodeW / 2, y2: B.y };
  };

  // Where the store's rows and the idempotency hint sit.
  const store = L.pos.ledger, gw = L.pos.gateway;
  const rowsAt = L.vertical ? { x: store.x + L.nodeW / 2 + 14, y: store.y - 30 } : { x: store.x - L.nodeW / 2, y: store.y + L.nodeH / 2 + 14 };
  const rowW = L.vertical ? 140 : L.nodeW;
  const hintAt = L.vertical ? { x: gw.x + L.nodeW / 2 + 14, y: gw.y + 4, anchor: 'start' as const } : { x: gw.x, y: gw.y + L.nodeH / 2 + 26, anchor: 'middle' as const };
  const chipAt = (lane: Lane) => (L.vertical ? { x: L.pos[lane].x + L.nodeW / 2 + 12, y: L.pos[lane].y - 4 } : { x: L.pos[lane].x, y: L.pos[lane].y - L.nodeH / 2 - 22 });

  return (
    <svg viewBox={`0 0 ${L.w} ${L.h}`} role="img" className={vertical ? 'flow vertical' : 'flow'}
      aria-label="Flow diagram: the user asks the agent, the agent calls the gateway, the gateway calls the tool, and the tool writes to the store.">
      <defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter></defs>

      {EDGES.map(([a, b]) => <line key={a + b} {...edgeEnds(a, b)} className="edge" />)}
      {ev && moving && gap(ev.src, ev.dst) > 1 && <path d={arcPath(L, ev.src, ev.dst)} className="edge arc" style={{ stroke: COLOR[ev.status] }} />}
      {ev && moving && gap(ev.src, ev.dst) === 1 && (
        <line {...edgeEnds(...(ORDER.indexOf(ev.src) < ORDER.indexOf(ev.dst) ? [ev.src, ev.dst] as const : [ev.dst, ev.src] as const))} className="edge on" style={{ stroke: COLOR[ev.status] }} />
      )}

      {ORDER.map(l => {
        const n = L.pos[l], c = lit(l), m = META[l];
        return (
          <g key={l} transform={`translate(${n.x - L.nodeW / 2} ${n.y - L.nodeH / 2})`}>
            {c && <rect width={L.nodeW} height={L.nodeH} rx="18" fill={c} opacity=".35" filter="url(#glow)" />}
            <rect width={L.nodeW} height={L.nodeH} rx="18" className="node" style={c ? { stroke: c, strokeWidth: 2 } : undefined} />
            <text x={L.nodeW / 2} y={L.vertical ? 28 : 34} textAnchor="middle" className="node-title">{m.title}</text>
            <text x={L.nodeW / 2} y={L.vertical ? 48 : 55} textAnchor="middle" className="node-sub">{m.sub}</text>
          </g>
        );
      })}

      <g transform={`translate(${rowsAt.x} ${rowsAt.y})`}>
        {rows.slice(-4).map((r, i) => (
          <g key={r.text + i} transform={`translate(0 ${i * 22})`}>
            <rect width={rowW} height="18" rx="9" className={r.gone ? 'row gone' : 'row'} />
            <text x="9" y="13" className={r.gone ? 'row-text gone' : 'row-text'}>{r.text.length > 21 ? r.text.slice(0, 20) + '…' : r.text}</text>
          </g>
        ))}
      </g>
      {hint && <text x={hintAt.x} y={hintAt.y} textAnchor={hintAt.anchor} className="hint">{hint.label}</text>}

      {ev && pos && (
        <g transform={`translate(${pos.x} ${pos.y})`}>
          <circle r="16" fill={COLOR[ev.status]} opacity=".25" />
          <circle r="7" fill={COLOR[ev.status]} />
          {L.vertical ? <Chip text={ev.label} color={COLOR[ev.status]} x={20} anchor="start" /> : <Chip text={ev.label} color={COLOR[ev.status]} y={-30} />}
        </g>
      )}
      {ev && !moving && (
        <g transform={`translate(${L.pos[ev.src].x} ${L.pos[ev.src].y})`}>
          <rect x={-L.nodeW / 2 - 6} y={-L.nodeH / 2 - 6} width={L.nodeW + 12} height={L.nodeH + 12} rx="22" fill="none"
            stroke={COLOR[ev.status]} strokeWidth="2" opacity={reduced ? 0.8 : 1 - p * 0.7} />
          <g transform={`translate(${chipAt(ev.src).x - L.pos[ev.src].x} ${chipAt(ev.src).y - L.pos[ev.src].y})`}>
            <Chip text={ev.label} color={COLOR[ev.status]} anchor={L.vertical ? 'start' : 'middle'} />
          </g>
        </g>
      )}
    </svg>
  );
}

function Chip({ text, color, x = 0, y = 0, anchor = 'middle' }: { text: string; color: string; x?: number; y?: number; anchor?: 'start' | 'middle' }) {
  const w = Math.max(54, text.length * 7.2 + 20);
  const left = anchor === 'start' ? 0 : -w / 2;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={left} y={-13} width={w} height={26} rx="13" fill={color} />
      <text x={left + w / 2} textAnchor="middle" y="5" className="chip-text">{text}</text>
    </g>
  );
}
