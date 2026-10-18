// app/js/household.js
// The household names: pure helpers for the "Household" section of the Manage
// tab. The rules mirror checkUsers() in backend/05_Api.gs.js, so a name the
// section accepts is a name the server accepts. The server still has the last
// word; this only saves a round trip and words the problem in place.
//
// There is no rename: an expense is stored under the person's name, so a renamed
// household member would orphan their history. Remove and add are the only edits.

import { esc } from './render.js';

export const MAX_HOUSEHOLD_NAMES = 10;
export const MAX_HOUSEHOLD_NAME_LENGTH = 30;

/** The household names as a clean list of non-empty strings; anything else gives []. */
export function householdNames(users) {
  if (!Array.isArray(users)) return [];
  return users.map((u) => String(u ?? '').trim()).filter(Boolean);
}

/**
 * Add `raw` to `list`. Returns `{ list }` with the name appended (trimmed), or
 * `{ list, error }` with the list unchanged and a sentence for the screen.
 */
export function addName(list, raw) {
  const current = householdNames(list);
  const name = String(raw ?? '').trim();
  if (name === '') return { list: current, error: 'Type a name first.' };
  if (name.includes(',')) return { list: current, error: 'A name cannot contain a comma.' };
  if (name.length > MAX_HOUSEHOLD_NAME_LENGTH) {
    return { list: current, error: `A name must be ${MAX_HOUSEHOLD_NAME_LENGTH} characters or fewer.` };
  }
  if (current.length >= MAX_HOUSEHOLD_NAMES) {
    return { list: current, error: `No more than ${MAX_HOUSEHOLD_NAMES} household members.` };
  }
  const key = name.toLowerCase();
  if (current.some((n) => n.toLowerCase() === key)) {
    return { list: current, error: `${name} is already in the household.` };
  }
  return { list: [...current, name] };
}

/** `list` without `name` (exact match); a name that is not there changes nothing. */
export function removeName(list, name) {
  return householdNames(list).filter((n) => n !== name);
}

/** True when both lists hold the same names in the same order. */
export function sameNames(a, b) {
  const x = householdNames(a);
  const y = householdNames(b);
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/** The list of names with a Remove button each, or a short prompt when empty. Names pass through esc(). */
export function householdHtml(list) {
  const names = householdNames(list);
  if (names.length === 0) {
    return '<p class="pb-empty px-1 py-3 text-sm text-slate-500">' +
      'No one yet. Add the people who share this budget.</p>';
  }
  return '<ul class="pb-household__list divide-y divide-slate-800">' +
    names.map((n) => (
      '<li class="pb-household__row flex items-center justify-between gap-3 py-2">' +
      `<span class="min-w-0 truncate text-sm text-slate-200">${esc(n)}</span>` +
      '<button type="button" class="rounded-lg border border-slate-500 px-2.5 py-1 text-xs' +
      ` font-semibold text-slate-200" data-action="remove-user" data-name="${esc(n)}">Remove</button></li>`
    )).join('') + '</ul>';
}
