export type Lane = 'user' | 'agent' | 'gateway' | 'tool' | 'ledger';
export type Status = 'ok' | 'warn' | 'error';

export interface TraceEvent {
  id: number;
  t: number;
  dur: number;
  src: Lane;
  dst: Lane;
  kind: string;
  label: string;
  detail: string;
  status: Status;
  data: Record<string, unknown>;
}

export type Toggle =
  | { key: string; label: string; type: 'bool'; default: boolean; help?: string }
  | { key: string; label: string; type: 'choice'; default: string; options: { value: string; label: string }[]; help?: string };

export interface Scenario {
  id: string;
  title: string;
  post: string;
  summary: string;
  prompt: string;
  toggles: Toggle[];
}

export interface Fact { label: string; value: string; status: Status }
export interface Outcome { verdict: 'good' | 'bad' | 'info'; title: string; facts: Fact[] }
export interface RunResult {
  scenario: string;
  toggles: Record<string, boolean | string>;
  events: TraceEvent[];
  final: string;
  outcome: Outcome;
  total_ms: number;
}
