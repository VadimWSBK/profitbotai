/**
 * Helpers for contact.phone stored as JSONB array of strings ["+1234567890", "+0987654321"].
 * First element = primary phone (used for communication: SMS, etc.).
 */

export function parsePhonesFromDb(value: unknown): string[] {
	if (value == null) return [];
	if (Array.isArray(value)) return value.filter((p): p is string => typeof p === 'string');
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value) as unknown;
			return parsePhonesFromDb(parsed);
		} catch {
			return value.trim() ? [value.trim()] : [];
		}
	}
	return [];
}

/** Primary phone = first in array (used for outbound communication), or null if empty. */
export function getPrimaryPhone(value: unknown): string | null {
	const arr = parsePhonesFromDb(value);
	return arr.length > 0 ? arr[0] : null;
}

/** Normalize input (string or string[]) to JSONB array for DB. */
export function phonesToJsonb(input: string | string[] | null | undefined): string[] {
	if (input == null) return [];
	if (Array.isArray(input)) {
		return input
			.map((p) => (typeof p === 'string' ? p.trim() : ''))
			.filter(Boolean);
	}
	const s = typeof input === 'string' ? input.trim() : '';
	return s ? [s] : [];
}

/** Merge a new phone into existing list (dedupe). Returns array for DB. */
export function mergePhoneIntoList(
	current: unknown,
	newPhone: string | null | undefined
): string[] {
	const list = parsePhonesFromDb(current);
	const add = typeof newPhone === 'string' ? newPhone.trim() : '';
	if (!add) return list;
	if (list.includes(add)) return list;
	return [...list, add];
}

/** Merge multiple phone arrays, deduplicating. */
export function mergePhoneArrays(...arrays: unknown[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const arr of arrays) {
		const phones = parsePhonesFromDb(arr);
		for (const phone of phones) {
			if (!seen.has(phone)) {
				seen.add(phone);
				result.push(phone);
			}
		}
	}
	return result;
}
