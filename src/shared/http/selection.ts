import { badRequest } from '../errors/AppError';

/** Most rows one "confirm selected" can touch (two pages of 50, plus room). */
export const MAX_SELECTION = 200;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a list of selected row ids from a request body: unique, well-formed, at most 200. */
export function selectedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest('Select at least one row.');
  if (value.length > MAX_SELECTION) throw badRequest(`Select at most ${MAX_SELECTION} at a time.`);
  const ids = [...new Set(value.map((id) => String(id).trim().toLowerCase()))];
  if (ids.some((id) => !ID_PATTERN.test(id))) throw badRequest('The selection contains an invalid id.');
  return ids;
}
