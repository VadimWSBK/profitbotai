/**
 * Helpers for contact.email stored as JSONB array of strings ["a@x.com", "b@y.com"].
 * First element = primary email for backward compatibility.
 */

export function parseEmailsFromDb(value: unknown): string[] {
	if (value == null) return [];
	if (Array.isArray(value)) return value.filter((e): e is string => typeof e === 'string');
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value) as unknown;
			return parseEmailsFromDb(parsed);
		} catch {
			return value.trim() ? [value.trim()] : [];
		}
	}
	return [];
}

/** Primary email = first in array, or null if empty. */
export function getPrimaryEmail(value: unknown): string | null {
	const arr = parseEmailsFromDb(value);
	return arr.length > 0 ? arr[0] : null;
}

/** Normalize input (string or string[]) to JSONB array for DB. */
export function emailsToJsonb(input: string | string[] | null | undefined): string[] {
	if (input == null) return [];
	if (Array.isArray(input)) {
		return input
			.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
			.filter(Boolean);
	}
	const s = typeof input === 'string' ? input.trim().toLowerCase() : '';
	return s ? [s] : [];
}

/** Merge a new email into existing list (dedupe, lowercase). Returns array for DB. */
export function mergeEmailIntoList(
	current: unknown,
	newEmail: string | null | undefined
): string[] {
	const list = parseEmailsFromDb(current);
	const add = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';
	if (!add) return list;
	if (list.includes(add)) return list;
	return [...list, add];
}
