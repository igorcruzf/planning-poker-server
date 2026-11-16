import { Inject, Injectable } from '@nestjs/common';
import { AtlassianAuthClient, AtlassianAuthFailure, AtlassianTokens } from './atlassian-auth.client';
import { JiraAppException, jiraError, rateLimitedError } from './jira-app.exception';
import type { JiraAuthConfig } from './jira-auth.config';
import type { Clock, Sleep } from './jira-auth.tokens';
import { JIRA_AUTH_CONFIG, JIRA_CLOCK, JIRA_SLEEP } from './jira-auth.tokens';
import { SessionBlobCodec, SessionPayload } from './session-blob';

export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
export const REFRESH_ROTATION_GRACE_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 500;
export const RATE_LIMIT_MAX_DELAY_MS = 8000;

export interface JiraAccessGrant {
    accessToken: string;
    cloudId: string;
    accountId: string;
    refreshedBlob?: string;
}

interface CachedSession {
    keys: Set<string>;
    currentBlob: string;
    cloudId: string;
    accountId: string;
    accessToken?: string;
    expiresAt: number;
    retainUntil: number;
    renewal?: Promise<void>;
}

@Injectable()
export class JiraSessionService {
    private readonly sessions = new Map<string, CachedSession>();
    private readonly codec?: SessionBlobCodec;

    constructor(
        @Inject(JIRA_AUTH_CONFIG) private readonly config: JiraAuthConfig,
        private readonly client: AtlassianAuthClient,
        @Inject(JIRA_CLOCK) private readonly clock: Clock,
        @Inject(JIRA_SLEEP) private readonly sleep: Sleep,
    ) {
        this.codec = config.enabled ? new SessionBlobCodec(config.encryptionKey) : undefined;
    }

    get size(): number {
        return this.sessions.size;
    }

    createBlob(payload: Omit<SessionPayload, 'v' | 'issuedAt'>): string {
        return this.requireCodec().encode({ v: 1, ...payload, issuedAt: this.clock() });
    }

    prime(blob: string, accessToken: string, expiresInMs: number): void {
        const session = this.sessionFor(blob);
        this.storeAccessToken(session, accessToken, expiresInMs);
    }

    async getAccessToken(blob: string): Promise<JiraAccessGrant> {
        const session = this.sessionFor(blob);
        if (!this.hasUsableToken(session)) {
            session.renewal ??= this.renew(session).finally(() => {
                session.renewal = undefined;
            });
            await session.renewal;
        }
        this.touch(session);
        return this.grantFor(session, blob);
    }

    logout(blob: string): void {
        this.requireCodec();
        const session = this.sessions.get(SessionBlobCodec.fingerprint(blob));
        if (session) {
            this.evict(session);
        }
    }

    sweep(): void {
        const now = this.clock();
        for (const session of new Set(this.sessions.values())) {
            if (session.retainUntil <= now) {
                this.evict(session);
            }
        }
    }

    private requireCodec(): SessionBlobCodec {
        if (!this.codec) {
            throw jiraError('jira_disabled');
        }
        return this.codec;
    }

    private sessionFor(blob: string): CachedSession {
        const codec = this.requireCodec();
        const key = SessionBlobCodec.fingerprint(blob);
        const cached = this.sessions.get(key);
        if (cached) {
            return cached;
        }
        const payload = codec.decode(blob);
        const session: CachedSession = {
            keys: new Set([key]),
            currentBlob: blob,
            cloudId: payload.cloudId,
            accountId: payload.accountId,
            expiresAt: 0,
            retainUntil: this.clock() + REFRESH_ROTATION_GRACE_MS,
        };
        this.sessions.set(key, session);
        return session;
    }

    private hasUsableToken(session: CachedSession): boolean {
        return session.accessToken !== undefined && this.clock() < session.expiresAt - TOKEN_EXPIRY_MARGIN_MS;
    }

    private storeAccessToken(session: CachedSession, accessToken: string, expiresInMs: number): void {
        session.accessToken = accessToken;
        session.expiresAt = this.clock() + expiresInMs;
        this.touch(session);
    }

    private touch(session: CachedSession): void {
        session.retainUntil = Math.max(session.expiresAt, this.clock()) + REFRESH_ROTATION_GRACE_MS;
    }

    private grantFor(session: CachedSession, presentedBlob: string): JiraAccessGrant {
        const grant: JiraAccessGrant = {
            accessToken: session.accessToken!,
            cloudId: session.cloudId,
            accountId: session.accountId,
        };
        return session.currentBlob === presentedBlob ? grant : { ...grant, refreshedBlob: session.currentBlob };
    }

    private async renew(session: CachedSession): Promise<void> {
        try {
            const payload = this.requireCodec().decode(session.currentBlob);
            const tokens = await this.refreshWithBackoff(payload.refreshToken);
            this.storeAccessToken(session, tokens.accessToken, tokens.expiresInMs);
            if (tokens.refreshToken !== payload.refreshToken) {
                this.rotate(session, { ...payload, refreshToken: tokens.refreshToken, issuedAt: this.clock() });
            }
        } catch (error) {
            this.evict(session);
            throw this.toException(error);
        }
    }

    private rotate(session: CachedSession, payload: SessionPayload): void {
        const blob = this.requireCodec().encode(payload);
        const key = SessionBlobCodec.fingerprint(blob);
        session.currentBlob = blob;
        session.keys.add(key);
        this.sessions.set(key, session);
    }

    private evict(session: CachedSession): void {
        for (const key of session.keys) {
            this.sessions.delete(key);
        }
    }

    private async refreshWithBackoff(refreshToken: string): Promise<AtlassianTokens> {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await this.client.refresh(refreshToken);
            } catch (error) {
                if (!(error instanceof AtlassianAuthFailure) || error.kind !== 'rate_limited') {
                    throw error;
                }
                const delayMs = this.backoffDelay(attempt, error.retryAfterMs);
                if (attempt + 1 >= RATE_LIMIT_MAX_ATTEMPTS) {
                    throw rateLimitedError('jira_rate_limited', delayMs);
                }
                await this.sleep(delayMs);
            }
        }
    }

    private backoffDelay(attempt: number, retryAfterMs = 0): number {
        const exponential = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
        return Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.max(exponential, retryAfterMs));
    }

    private toException(error: unknown): JiraAppException {
        if (error instanceof JiraAppException) {
            return error;
        }
        if (error instanceof AtlassianAuthFailure && error.kind === 'invalid_grant') {
            return jiraError('jira_reconnect_required');
        }
        return jiraError('jira_unavailable');
    }
}
