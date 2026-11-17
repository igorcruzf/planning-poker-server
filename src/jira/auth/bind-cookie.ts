import { JIRA_AUTH_PATHS, JIRA_OAUTH_STATE_TTL_MS } from '../../contracts';

export const BIND_COOKIE_NAME = 'yak_jira_bind';

const BIND_COOKIE_PATH = JIRA_AUTH_PATHS.login.replace(/\/[^/]+$/, '');
const BIND_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_COOKIE_HEADER_LENGTH = 4096;

const serialize = (value: string, maxAgeSeconds: number, secure: boolean): string =>
    [
        `${BIND_COOKIE_NAME}=${value}`,
        `Path=${BIND_COOKIE_PATH}`,
        `Max-Age=${maxAgeSeconds}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(secure ? ['Secure'] : []),
    ].join('; ');

export const serializeBindCookie = (bind: string, secure: boolean): string =>
    serialize(bind, JIRA_OAUTH_STATE_TTL_MS / 1000, secure);

export const clearBindCookie = (secure: boolean): string => serialize('', 0, secure);

export const readBindCookie = (cookieHeader?: string): string | undefined => {
    if (!cookieHeader || cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) {
        return undefined;
    }
    const prefix = `${BIND_COOKIE_NAME}=`;
    const entry = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
    const value = entry?.slice(prefix.length);
    return value !== undefined && BIND_VALUE_PATTERN.test(value) ? value : undefined;
};
