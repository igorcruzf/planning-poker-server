import { JIRA_AUTHORIZATION_HEADER, JIRA_SESSION_HEADER, ROOM_SESSION_HEADER } from './contracts';

export const DEFAULT_CORS_ORIGINS = ['https://yak-planning-poker.onrender.com'];

const parseOrigins = (value: string): string[] =>
    value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

export const corsOrigin = (value = process.env.CORS_ORIGIN): string | string[] => {
    const configured = parseOrigins(value ?? '');
    const origins = configured.length > 0 ? configured : DEFAULT_CORS_ORIGINS;
    return origins.length === 1 ? origins[0] : [...origins];
};

export const CORS_ALLOWED_HEADERS = [JIRA_AUTHORIZATION_HEADER, 'Content-Type', ROOM_SESSION_HEADER];
export const CORS_EXPOSED_HEADERS = [JIRA_SESSION_HEADER];

export const corsOptions = (value = process.env.CORS_ORIGIN) => ({
    origin: corsOrigin(value),
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
});
