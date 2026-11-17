import { Logger } from '@nestjs/common';
import { JIRA_PRODUCTION_CALLBACK_URL, httpUrlSchema } from '../../contracts';
import { corsOrigin, DEFAULT_CORS_ORIGINS } from '../../cors-origin';
import { SESSION_KEY_BYTES } from './session-blob';

export interface JiraDisabledConfig {
    enabled: false;
    frontUrl: string;
}

export interface JiraEnabledConfig {
    enabled: true;
    clientId: string;
    clientSecret: string;
    encryptionKey: Buffer;
    redirectUri: string;
    frontUrl: string;
    toJSON?(): { enabled: true };
}

export type JiraAuthConfig = JiraDisabledConfig | JiraEnabledConfig;

type Environment = Record<string, string | undefined>;

const logger = new Logger('JiraAuthConfig');

const read = (env: Environment, name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
};

const asHttpUrl = (value: string | undefined): string | undefined => {
    const parsed = httpUrlSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
};
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const asFrontUrl = (value: string | undefined, env: Environment): string | undefined => {
    const url = asHttpUrl(value);
    if (!url) return undefined;
    const { protocol, hostname } = new URL(url);
    const isLocalDevelopment = protocol === 'http:' && LOOPBACK_HOSTS.has(hostname) && env.NODE_ENV !== 'production';
    return protocol === 'https:' || isLocalDevelopment ? url : undefined;
};
const resolveFrontUrl = (env: Environment): string => {
    const origins = [corsOrigin(env.CORS_ORIGIN)].flat();
    const fallback = asFrontUrl(origins[0], env) ?? DEFAULT_CORS_ORIGINS[0];
    const requested = read(env, 'FRONT_URL');
    const configured = asFrontUrl(requested, env);
    if (requested && !configured) {
        logger.warn('FRONT_URL must be https (or http on localhost outside production); using the default front');
    }
    return new URL(configured ?? fallback).origin;
};
const decodeEncryptionKey = (value: string): Buffer | undefined => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        return undefined;
    }
    const key = Buffer.from(value, 'base64');
    return key.length === SESSION_KEY_BYTES ? key : undefined;
};

export const loadJiraAuthConfig = (env: Environment = process.env): JiraAuthConfig => {
    const frontUrl = resolveFrontUrl(env);
    const clientId = read(env, 'JIRA_CLIENT_ID');
    const clientSecret = read(env, 'JIRA_CLIENT_SECRET');
    const rawKey = read(env, 'SESSION_ENC_KEY');
    if (!clientId || !clientSecret || !rawKey) {
        return { enabled: false, frontUrl };
    }
    const encryptionKey = decodeEncryptionKey(rawKey);
    if (!encryptionKey) {
        logger.warn(`SESSION_ENC_KEY must be ${SESSION_KEY_BYTES} bytes in base64; Jira is disabled`);
        return { enabled: false, frontUrl };
    }
    return {
        enabled: true,
        clientId,
        clientSecret,
        encryptionKey,
        redirectUri: asHttpUrl(read(env, 'JIRA_REDIRECT_URI')) ?? JIRA_PRODUCTION_CALLBACK_URL,
        frontUrl,
        toJSON: () => ({ enabled: true }),
    };
};
