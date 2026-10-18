import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getScenarios, runScenario } from './api';
import { Timeline } from './Timeline';
import { Waterfall } from './Waterfall';
import { reducedMotion, usePlayback } from './usePlayback';
import type { RunResult, Scenario, Toggle } from './types';

const SITE = 'https://ammar-site-black.vercel.app';

function useMedia(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** How long each step lasts on screen. Real durations are stretched a little, and a 5 s timeout is shortened to stay watchable. */
function schedule(result: RunResult | null) {
  const evs = result?.events ?? [];
  const durs = evs.map(e => (e.kind === 'timeout' ? 3200 : Math.min(1500, Math.max(900, e.dur * 1.5))));
  const starts: number[] = [];
  durs.reduce((acc, d, i) => { starts[i] = acc; return acc + d; }, 0);
  const total = durs.reduce((a, b) => a + b, 0) + 800;
  return { durs, starts, total };
}

export default function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sid, setSid] = useState('timeout');
  const [toggles, setToggles] = useState<Record<string, boolean | string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState('');
  const reduced = useMemo(reducedMotion, []);
  const small = useMedia('(max-width: 720px)');
  const scn = scenarios.find(s => s.id === sid);
  const { durs, starts, total } = useMemo(() => schedule(result), [result]);
  const pb = usePlayback(total);
  const seq = useRef(0);

  useEffect(() => { getScenarios().then(setScenarios).catch(e => setError(e.message)); }, []);

  const run = useCallback(async (id: string, tg: Record<string, boolean | string>) => {
    const mine = ++seq.current;
    try {
      const r = await runScenario(id, tg);
      if (mine !== seq.current) return;
      setError('');
      setResult(r);
      pb.restart(!reduced);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const pick = (s: Scenario) => {
    const defaults = Object.fromEntries(s.toggles.map(t => [t.key, t.default]));
    setSid(s.id); setToggles(defaults); run(s.id, defaults);
    const u = new URL(location.href); u.searchParams.set('scenario', s.id); history.replaceState(null, '', u);
  };
  const change = (t: Toggle, value: boolean | string) => {
    const next = { ...toggles, [t.key]: value };
    setToggles(next); run(sid, next);
  };

  useEffect(() => {
    if (!scenarios.length) return;
    const wanted = new URLSearchParams(location.search).get('scenario');
    pick(scenarios.find(s => s.id === wanted) ?? scenarios[0]); // first load; ?scenario=id deep-links
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios.length]);

  // The step on screen right now.
  const events = result?.events ?? [];
  let active = -1;
  starts.forEach((s, i) => { if (pb.t >= s) active = i; });
  const progress = active >= 0 ? Math.min(1, (pb.t - starts[active]) / durs[active]) : 0;
  const finished = result !== null && pb.t >= total - 1;

  return (
    <div className="page">
      <header className="top">
        <p className="kicker">Interactive</p>
        <h1>Agent Gateway Playground</h1>
        <p className="lede">Break an AI agent on purpose. A real Microsoft Agent Framework agent calls tools through a mock gateway. Flip a switch and watch every step.</p>
      </header>

      <nav className="tabs" aria-label="Scenarios">
        {scenarios.map(s => (
          <button key={s.id} type="button" className={s.id === sid ? 'tab on' : 'tab'} aria-pressed={s.id === sid} onClick={() => pick(s)}>
            <span className="t-long">{s.title}</span><span className="t-short">{s.short}</span>
          </button>
        ))}
      </nav>

      {error && <p className="error" role="alert">{error}</p>}

      {scn && (
        <>
          <section className="tile config">
            <div className="cfg-intro">
              <h2>{scn.title}</h2>
              <p className="muted">{scn.summary}</p>
              <p className="prompt"><span>User asks</span>“{scn.prompt}”</p>
              <a className="link" href={`${SITE}/posts/${scn.post}`}>Read the post behind this ›</a>
            </div>
            <div className="toggles">
              {scn.toggles.map(t => t.type === 'bool' ? (
                <label key={t.key} className="toggle">
                  <input type="checkbox" checked={Boolean(toggles[t.key])} onChange={e => change(t, e.target.checked)} />
                  <span className="switch" aria-hidden="true" />
                  <span className="t-text"><strong>{small ? t.short : t.label}</strong>{t.help && <small>{t.help}</small>}</span>
                </label>
              ) : (
                <label key={t.key} className="choice">
                  <strong>{small ? t.short : t.label}</strong>
                  <select value={String(toggles[t.key] ?? t.default)} onChange={e => change(t, e.target.value)}>
                    {t.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="stage-row">
            <div className="tile stage">
              <Timeline events={events} active={active} progress={progress} reduced={reduced} small={small} final={result?.final ?? ''} />
              <div className="dock">
                <div className="bar">
                  <button type="button" className="btn primary" onClick={pb.playing ? pb.pause : pb.play} disabled={!result}>{pb.playing ? 'Pause' : finished ? 'Replay' : 'Play'}</button>
                  <button type="button" className="btn" aria-label="Previous step" onClick={() => pb.seek(starts[Math.max(0, active - 1)] ?? 0)} disabled={!result || active <= 0}>‹</button>
                  <button type="button" className="btn" aria-label="Next step" onClick={() => pb.seek((starts[Math.min(events.length - 1, active + 1)] ?? 0) + 1)} disabled={!result || active >= events.length - 1}>›</button>
                  <input type="range" min={0} max={Math.round(total)} value={Math.round(pb.t)} onChange={e => pb.seek(Number(e.target.value))} aria-label="Position in the run" />
                  <select value={pb.speed} onChange={e => pb.setSpeed(Number(e.target.value))} aria-label="Speed">
                    <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
                  </select>
                </div>
              </div>
            </div>

            <div className={`tile outcome ${finished && result ? result.outcome.verdict : 'wait'}`}>
              <h3>Outcome</h3>
              {finished && result ? (
                <>
                  <p className="verdict">{result.outcome.title}</p>
                  <dl>{result.outcome.facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd className={f.status}>{f.value}</dd></div>)}</dl>
                </>
              ) : <p className="muted">The result appears when the run finishes.</p>}
            </div>
          </section>

          <details className="tile trace">
            <summary><span>Trace</span><em>{events.length} steps</em></summary>
            <Waterfall events={events} starts={starts} durs={durs} total={total} active={active} onPick={i => pb.seek(starts[i] + 1)} />
          </details>
        </>
      )}

      <footer className="foot">
        <p>The agent is real Microsoft Agent Framework code. Its model is a small scripted planner, so every run is repeatable and needs no API key. The tools are fake and live in memory.</p>
      </footer>
    </div>
  );
}
