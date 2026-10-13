// Sequences (Revu Tool Chest > Sequence): a tool whose markups number
// themselves as they are placed. Each placement continues the current run
// of that tool in the document; Reset starts a new run from the start value.
import type { Markup } from './types';

export interface SequenceDef {
  format: 'number' | 'upper' | 'lower';
  start: number;
  step: number;
  /** Minimum digits for numbers (leading zeros). */
  digits: number;
  prefix: string;
  suffix: string;
  /** Current run; Reset increments it. */
  run: number;
}

export const DEFAULT_SEQUENCE: SequenceDef = { format: 'number', start: 1, step: 1, digits: 1, prefix: '', suffix: '', run: 1 };

/** 1 -> A, 26 -> Z, 27 -> AA (spreadsheet-style). */
export function letters(n: number): string {
  let s = '';
  for (let k = Math.max(1, Math.floor(n)); k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

export function formatSequence(def: SequenceDef, n: number): string {
  const body = def.format === 'number' ? String(n).padStart(Math.max(1, def.digits), '0')
    : def.format === 'upper' ? letters(n) : letters(n).toLowerCase();
  return `${def.prefix}${body}${def.suffix}`;
}

/** The next value of the sequence `id` in these markups (current run). */
export function nextInSequence(markups: Markup[], id: string, def: SequenceDef): number {
  const used = markups.filter((m) => m.seq?.id === id && m.seq.run === def.run).map((m) => m.seq!.n);
  return used.length ? Math.max(...used) + (def.step || 1) : def.start;
}

/** Ids of the markups in the same sequence run as `m`. */
export function sequenceMembers(markups: Markup[], m: Markup): string[] {
  return m.seq ? markups.filter((x) => x.seq?.id === m.seq!.id && x.seq.run === m.seq!.run).map((x) => x.id) : [m.id];
}
