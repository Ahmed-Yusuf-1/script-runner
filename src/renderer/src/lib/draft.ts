// A copy of unsaved edits, kept in this browser profile so a crash, a power cut
// or a forced quit can't lose work. It is offered back on the next start.

import type { Flow } from '@shared/types';
import { normalizeFlow } from '@shared/normalize';

const KEY = 'draft.v1';
/** Drafts older than this are stale and ignored. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Draft {
  flow: Flow;
  /** What the flow looked like when it was last saved (null = never saved). */
  savedSnap: string | null;
  at: number;
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* storage full or unavailable: the draft is a nicety, not a requirement */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const flow = normalizeFlow(parsed?.flow);
    if (!flow || typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) {
      clearDraft();
      return null;
    }
    return { flow, savedSnap: typeof parsed.savedSnap === 'string' ? parsed.savedSnap : null, at: parsed.at };
  } catch {
    clearDraft();
    return null;
  }
}
