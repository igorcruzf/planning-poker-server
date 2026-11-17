import { Inject, Injectable } from '@nestjs/common';
import { JIRA_AUTHORIZATION_SCHEME, jiraAuthorizationHeaderSchema } from '../../contracts';
import { AtlassianAuthClient, AtlassianAuthFailure, AtlassianTokens } from './atlassian-auth.client';
import { JiraAppException, jiraError, rateLimitedError } from './jira-app.exception';
import type { JiraAuthConfig } from './jira-auth.config';
import type { Clock, Sleep } from './jira-auth.tokens';
import { JIRA_AUTH_CONFIG, JIRA_CLOCK, JIRA_SLEEP } from './jira-auth.tokens';
import { RevokedBlobVault } from './revoked-blob-vault';
import { SessionBlobCodec, SessionPayload } from './session-blob';

export const BLOB_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const BLOB_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
export const REFRESH_ROTATION_GRACE_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 500;
export const RATE_LIMIT_MAX_DELAY_MS = 8000;

export interface JiraAccessGrant {
    accessToken: string;
    cloudId: string;
    accountId: string;
    siteUrl: string;
    refreshedBlob?: string;
}

export const parseBearerBlob = (authorization?: string): string | undefined =>
    jiraAuthorizationHeaderSchema.safeParse(authorization).success
        ? authorization!.slice(JIRA_AUTHORIZATION_SCHEME.length + 1)
        : undefined;

interface CachedSession {
    keys: Set<string>;
    currentBlob: string;
    cloudId: string;
    accountId: string;
    siteUrl: string;
    accessToken?: string;
    expiresAt: number;
    retainUntil: number;
    renewal?: Promise<void>;
    revoked: boolean;
}

@Injectable()
export class JiraSessionService {
    private readonly sessions = new Map<string, CachedSession>();
    /** Revocations live in memory and are lost on restart; the blob maximum age bounds that window. */
    private readonly revokedBlobs = new RevokedBlobVault(BLOB_MAX_AGE_MS);
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
        return this.requireCodec().encode({
            v: 1,
            ...payload,
            issuedAt: this.clock(),
        });
    }

    prime(blob: string, accessToken: string, expiresInMs: number): void {
        const session = this.sessionFor(blob);
        this.storeAccessToken(session, accessToken, expiresInMs);
    }

    async getAccessToken(blob: string): Promise<JiraAccessGrant> {
        return this.grant(blob, false);
    }

    async forceRefresh(blob: string): Promise<JiraAccessGrant> {
        return this.grant(blob, true);
    }

    private async grant(blob: string, forceRenewal: boolean): Promise<JiraAccessGrant> {
        const session = this.sessionFor(blob);
        if (forceRenewal && !session.renewal) {
            session.accessToken = undefined;
        }
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
        if (!this.isAuthentic(blob)) {
            return;
        }
        const key = SessionBlobCodec.fingerprint(blob);
        this.revokedBlobs.revoke(key, this.clock());
        const session = this.sessions.get(key);
        if (session) {
            for (const generation of session.keys) {
                this.revokedBlobs.revoke(generation, this.clock());
            }
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

    private isAuthentic(blob: string): boolean {
        const codec = this.requireCodec();
        try {
            codec.decode(blob);
            return true;
        } catch {
            return false;
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
        if (this.revokedBlobs.isRevoked(key, this.clock())) {
            throw jiraError('jira_reconnect_required');
        }
        const cached = this.sessions.get(key);
        if (cached) {
            return cached;
        }
        const payload = codec.decode(blob);
        this.requireAcceptableIssuance(payload.issuedAt);
        const session: CachedSession = {
            keys: new Set([key]),
            currentBlob: blob,
            cloudId: payload.cloudId,
            accountId: payload.accountId,
            siteUrl: payload.siteUrl,
            revoked: false,
            expiresAt: 0,
            retainUntil: this.clock() + REFRESH_ROTATION_GRACE_MS,
        };
        this.sessions.set(key, session);
        return session;
    }

    private requireAcceptableIssuance(issuedAt: number): void {
        const age = this.clock() - issuedAt;
        if (age > BLOB_MAX_AGE_MS || age < -BLOB_FUTURE_TOLERANCE_MS) {
            throw jiraError('jira_reconnect_required');
        }
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
            siteUrl: session.siteUrl,
        };
        return session.currentBlob === presentedBlob ? grant : { ...grant, refreshedBlob: session.currentBlob };
    }

    private async renew(session: CachedSession): Promise<void> {
        try {
            const payload = this.requireCodec().decode(session.currentBlob);
            const tokens = await this.refreshWithBackoff(payload.refreshToken);
            if (session.revoked) {
                throw jiraError('jira_reconnect_required');
            }
            this.storeAccessToken(session, tokens.accessToken, tokens.expiresInMs);
            if (tokens.refreshToken !== payload.refreshToken) {
                this.rotate(session, {
                    ...payload,
                    refreshToken: tokens.refreshToken,
                    issuedAt: this.clock(),
                });
            }
        } catch (error) {
            if (error instanceof AtlassianAuthFailure && error.kind === 'invalid_grant') {
                this.evict(session);
            }
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
        session.revoked = true;
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
