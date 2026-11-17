import { RateWindow } from '../gateway/session/rate-limiter';
const MINUTE_MS = 60_000;
export const MCP_MAX_SESSIONS = 100;
export const MCP_SESSION_IDLE_MS = 30 * MINUTE_MS;
export const MCP_MAX_BODY_BYTES = 16 * 1024;
export const MCP_CALL_LIMIT: RateWindow = { limit: 30, windowMs: MINUTE_MS };
export const MCP_JOIN_ATTEMPT_LIMIT: RateWindow = { limit: 5, windowMs: 10 * MINUTE_MS };
export const MCP_ADDRESS_INITIALIZE_LIMIT: RateWindow = { limit: 10, windowMs: MINUTE_MS };
export const MCP_ADDRESS_MAX_LENGTH = 64;
