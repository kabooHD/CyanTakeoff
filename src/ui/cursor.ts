import { create } from 'zustand';
import type { Pt, Scale } from '../model/types';

/** Cursor position on the page, for the status bar readout. */
export const useCursor = create<{ p: Pt | null; scale: Scale | null }>(() => ({ p: null, scale: null }));

export const setCursor = (p: Pt | null, scale: Scale | null) => useCursor.setState({ p, scale });
