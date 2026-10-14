// Markup status models (Revu Markups List > Status > Manage Status): the
// built-in Review model (None, Accepted, Rejected, Cancelled, Completed)
// and custom models whose states can recolour the markup and set the text
// of a text box grouped with it. Custom models are kept with the profile
// (this browser); a markup stores its model, state, who set it and when.
import { create } from 'zustand';
import type { Markup } from './types';

export interface StatusState { name: string; color?: string; text?: string }
export interface StatusModel { name: string; states: StatusState[]; builtIn?: boolean; hidden?: boolean }

export const REVIEW: StatusModel = { name: 'Review', builtIn: true, states: ['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'].map((name) => ({ name })) };

export interface StatusConfig { models: StatusModel[]; defaultModel?: string; defaultState?: string }

const LS = 'cyantakeoff:status-models';
const load = (): StatusConfig => {
  try {
    const c = JSON.parse(localStorage.getItem(LS) ?? 'null') as StatusConfig | null;
    if (c?.models) return { ...c, models: [REVIEW, ...c.models.filter((m) => !m.builtIn)] };
  } catch { /* none saved */ }
  return { models: [REVIEW] };
};

export const useStatusModels = create<StatusConfig>(() => (typeof localStorage === 'undefined' ? { models: [REVIEW] } : load()));

export function saveStatusConfig(c: StatusConfig) {
  useStatusModels.setState(c, true);
  try { localStorage.setItem(LS, JSON.stringify({ ...c, models: c.models.filter((m) => !m.builtIn) })); } catch { /* storage full or blocked */ }
}

/** How a markup's status reads in the list ("Accepted", or "Valve: Open" for other models). */
export const statusLabel = (m: Pick<Markup, 'status' | 'statusModel'>) =>
  !m.statusModel || m.statusModel === 'Review' ? m.status : `${m.statusModel}: ${m.status}`;

/**
 * The changes that set a status on markups: the state, who and when, the
 * state's colour, and its text on text boxes grouped with each markup.
 */
export function statusChanges(markups: Markup[], ids: string[], model: string, state: string, by: string, when = new Date()): Map<string, Partial<Markup>> {
  const st = useStatusModels.getState().models.find((x) => x.name === model)?.states.find((x) => x.name === state);
  const out = new Map<string, Partial<Markup>>();
  const date = when.toISOString();
  for (const m of markups) {
    if (!ids.includes(m.id)) continue;
    out.set(m.id, {
      status: state, statusModel: model === 'Review' ? undefined : model, statusBy: by, statusDate: date,
      ...(st?.color ? { style: { ...m.style, color: st.color } } : {}),
    });
    if (st?.text !== undefined && m.groupId) {
      for (const t of markups) if (t.groupId === m.groupId && t.id !== m.id && (t.type === 'textbox' || t.type === 'callout')) out.set(t.id, { ...out.get(t.id), text: st.text });
    }
  }
  return out;
}
