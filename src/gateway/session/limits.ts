import { RateWindow } from './rate-limiter';

export const SOCKET_EVENT_LIMIT: RateWindow = { limit: 40, windowMs: 10_000 };
export const ADDRESS_EVENT_LIMIT: RateWindow = { limit: 200, windowMs: 10_000 };
export const ADDRESS_ENTRY_LIMIT: RateWindow = { limit: 20, windowMs: 60_000 };
export const ENTRY_EVENTS: ReadonlySet<string> = new Set(['room:create', 'room:join']);
export const MAX_CONNECTIONS_PER_ADDRESS = 30;
export const CONNECTION_RETRY_AFTER_MS = 10_000;
export const CLIENT_ADDRESS_MAX_LENGTH = 64;
