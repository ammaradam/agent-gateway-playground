import type { Lane, Status, TraceEvent } from './types';

const ORDER: Lane[] = ['user', 'agent', 'gateway', 'tool', 'ledger'];
const TITLE: Record<Lane, string> = { user: 'User', agent: 'Agent', gateway: 'Gateway', tool: 'Tool', ledger: 'Store' };
const SUB: Record<Lane, string> = { user: 'asks', agent: 'MAF agent', gateway: 'policy', tool: 'tickets', ledger: 'in memory' };
const ROLE: Record<Lane, string> = {
  user: 'Asks the agent to do something.',
  agent: 'Plans, then calls tools.',
  gateway: 'Checks policy and deduplicates.',
  tool: 'Runs the action.',
  ledger: 'Holds the data.',
};
const CHECKS = [['authz.agent', 'Agent'], ['authz.user', 'User'], ['authz.delegation', 'Delegation'], ['authz.resource', 'Resource']] as const;
const COLOR: Record<Status, string> = { ok: 'var(--blue)', warn: 'var(--amber)', error: 'var(--red)' };

/** Which node an event is described next to. */
const owner = (e: TraceEvent): Lane => (e.kind.startsWith('ledger.') ? 'ledger' : e.src);
const gap = (a: Lane, b: Lane) => Math.abs(ORDER.indexOf(a) - ORDER.indexOf(b));

interface Size { row: number; nodeW: number; nodeH: number }
const BIG: Size = { row: 88, nodeW: 140, nodeH: 58 };
const SMALL: Size = { row: 62, nodeW: 96, nodeH: 42 };

interface Props {
  events: TraceEvent[];
  active: number; // index of the current step, -1 before the run starts
  progress: number; // 0..1 inside the current step
  reduced: boolean;
  small: boolean;
  final: string;
}

export function Timeline({ events, active, progress, reduced, small, final }: Props) {
  const S = small ? SMALL : BIG;
  const cx = S.nodeW / 2 + 4;
  const W = S.nodeW + 38;
  const H = S.row * ORDER.length;
  const y = (l: Lane) => ORDER.indexOf(l) * S.row + S.row / 2;

  const ev = active >= 0 ? events[active] : null;
  const p = reduced ? 1 : progress;
  const moving = !!ev && ev.src !== ev.dst;
  const seen = events.slice(0, active + 1);

  // The packet's position, straight between neighbours or looping around the nodes in between.
  let packet: { x: number; y: number } | null = null;
  if (ev && moving) {
    const y0 = y(ev.src), y1 = y(ev.dst);
    if (gap(ev.src, ev.dst) > 1) {
      const bx = cx + S.nodeW + 8, q0 = (1 - p) * (1 - p), q1 = 2 * (1 - p) * p, q2 = p * p;
      packet = { x: q0 * cx + q1 * bx + q2 * cx, y: q0 * y0 + q1 * (y0 + y1) / 2 + q2 * y1 };
    } else packet = { x: cx, y: y0 + (y1 - y0) * p };
  }
  const touched = (l: Lane) => !!ev && (owner(ev) === l || ev.dst === l);
  const lit = (l: Lane) => (touched(l) && (p < 1 || !moving) ? COLOR[ev!.status] : undefined);

  // What to say next to each node.
  const say = (l: Lane): { label: string; detail: string; status: Status; now: boolean } | null => {
    const mine = seen.filter(e => owner(e) === l);
    const last = mine[mine.length - 1];
    if (!last) return null;
    if (last.kind === 'agent.final') return null;
    return { label: last.label, detail: last.detail, status: last.status, now: ev !== null && last.id === ev.id };
  };
  const finalSeen = seen.find(e => e.kind === 'agent.final');

  // Store contents.
  const rows: { text: string; gone?: boolean }[] = [];
  events.filter(e => e.kind === 'ledger.delete').forEach(e => rows.push({ text: `${e.label} · Q3 export`, gone: seen.some(s => s.id === e.id) }));
  seen.filter(e => e.kind === 'ledger.write').forEach(e => {
    const project = /project (\w+)/.exec(e.detail)?.[1];
    rows.push({ text: `${e.label}${project ? ` · ${project}` : ''}` });
  });
  const hasChecks = events.some(e => e.kind.startsWith('authz.'));

  return (
    <div className="timeline" style={{ ['--row' as string]: `${S.row}px` }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tl-svg" role="img"
        aria-label="Flow: the user asks the agent, the agent calls the gateway, the gateway calls the tool, and the tool writes to the store.">
        <defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter></defs>
        {ORDER.slice(0, -1).map((a, i) => (
          <line key={a} x1={cx} y1={y(a) + S.nodeH / 2} x2={cx} y2={y(ORDER[i + 1]) - S.nodeH / 2} className="edge" />
        ))}
        {ev && moving && gap(ev.src, ev.dst) === 1 && (
          <line x1={cx} x2={cx} y1={Math.min(y(ev.src), y(ev.dst)) + S.nodeH / 2} y2={Math.max(y(ev.src), y(ev.dst)) - S.nodeH / 2}
            className="edge on" style={{ stroke: COLOR[ev.status] }} />
        )}
        {ev && moving && gap(ev.src, ev.dst) > 1 && (
          <path d={`M ${cx} ${y(ev.src)} Q ${cx + S.nodeW + 8} ${(y(ev.src) + y(ev.dst)) / 2} ${cx} ${y(ev.dst)}`} className="edge arc" style={{ stroke: COLOR[ev.status] }} />
        )}
        {ORDER.map(l => {
          const c = lit(l);
          return (
            <g key={l} transform={`translate(${cx - S.nodeW / 2} ${y(l) - S.nodeH / 2})`}>
              {c && <rect width={S.nodeW} height={S.nodeH} rx="16" fill={c} opacity=".35" filter="url(#glow)" />}
              <rect width={S.nodeW} height={S.nodeH} rx="16" className="node" style={c ? { stroke: c, strokeWidth: 2 } : undefined} />
              <text x={S.nodeW / 2} y={small ? 18 : 25} textAnchor="middle" className="node-title">{TITLE[l]}</text>
              <text x={S.nodeW / 2} y={small ? 33 : 44} textAnchor="middle" className="node-sub">{SUB[l]}</text>
            </g>
          );
        })}
        {packet && ev && (
          <g transform={`translate(${packet.x} ${packet.y})`}>
            <circle r="14" fill={COLOR[ev.status]} opacity=".25" />
            <circle r="6.5" fill={COLOR[ev.status]} />
          </g>
        )}
        {ev && !moving && (
          <rect x={cx - S.nodeW / 2 - 5} y={y(ev.src) - S.nodeH / 2 - 5} width={S.nodeW + 10} height={S.nodeH + 10} rx="19" fill="none"
            stroke={COLOR[ev.status]} strokeWidth="2" opacity={reduced ? 0.8 : 1 - p * 0.7} />
        )}
      </svg>

      <ol className="tl-steps">
        {ORDER.map(l => {
          const s = say(l);
          const userFinal = l === 'user' && finalSeen;
          const text = userFinal ? { label: 'Agent replies', detail: `“${final}”`, status: finalSeen!.status, now: ev !== null && finalSeen!.id === ev.id } : s;
          const first = l === 'user' ? seen.find(e => e.kind === 'user.prompt') : null;
          return (
            <li key={l} className={`tl-step ${text?.now ? 'now' : ''} ${text ? '' : 'idle'}`} style={text ? { ['--c' as string]: COLOR[text.status] } : undefined}>
              {text ? (
                <p className="tl-text"><strong>{text.label}</strong> {text.detail}</p>
              ) : (
                <p className="tl-text">{first ? first.detail : ROLE[l]}</p>
              )}
              {l === 'user' && userFinal && first && <p className="tl-sub">{first.detail}</p>}
              {l === 'gateway' && hasChecks && (
                <ul className="checks" aria-label="Gateway checks">
                  {CHECKS.map(([kind, name]) => {
                    const hit = seen.find(e => e.kind === kind);
                    return <li key={kind} className={hit ? hit.status : 'pending'}><span className="dot" />{name}</li>;
                  })}
                </ul>
              )}
              {l === 'ledger' && rows.length > 0 && (
                <ul className="pills" aria-label="Store contents">
                  {rows.slice(-3).map((r, i) => <li key={r.text + i} className={r.gone ? 'gone' : ''}>{r.text}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
