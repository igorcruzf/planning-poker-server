export type Identifier = string | number;

export interface UserInfo {
    id: Identifier;
    room: Identifier;
    [field: string]: unknown;
}

export type UserChanges = Record<string, unknown>;

const isIdentifier = (value: unknown): value is Identifier =>
    (typeof value === 'string' && value.trim().length > 0) ||
    (typeof value === 'number' && Number.isFinite(value));

export const isUserChanges = (value: unknown): value is UserChanges =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const isUserInfo = (value: unknown): value is UserInfo =>
    isUserChanges(value) && isIdentifier(value.id) && isIdentifier(value.room);

export const toKey = (identifier: Identifier): string => String(identifier);
