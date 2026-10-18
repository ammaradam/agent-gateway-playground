import type { RunResult, Scenario } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`The server answered ${res.status}. Is the API running?`);
  return res.json() as Promise<T>;
}

export const getScenarios = () => fetch('/api/scenarios').then(json<Scenario[]>);

export const runScenario = (scenario: string, toggles: Record<string, boolean | string>) =>
  fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, toggles }),
  }).then(json<RunResult>);
