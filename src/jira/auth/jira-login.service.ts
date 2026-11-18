import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
    JIRA_LOGIN_CODE_QUERY_PARAM,
    JIRA_LOGIN_CODE_TTL_MS,
    JIRA_LOGIN_ERROR_QUERY_PARAM,
    JIRA_OAUTH_SCOPES,
    JiraLoginError,
    ROOM_LINK_QUERY_PARAM,
} from '../../contracts';
import { RateLimiter, RateWindow } from '../../gateway/session/rate-limiter';
import { AtlassianAuthClient } from './atlassian-auth.client';
import { clearBindCookie, readBindCookie, serializeBindCookie } from './bind-cookie';
import { jiraError, rateLimitedError } from './jira-app.exception';
import type { JiraAuthConfig, JiraEnabledConfig } from './jira-auth.config';
import type { Clock } from './jira-auth.tokens';
import { JIRA_AUTH_CONFIG, JIRA_CLOCK } from './jira-auth.tokens';
import { JiraSessionService } from './jira-session.service';
import { ConsumedNonces, LoginStateSigner, VerifiedLoginState } from './login-state';
import { OneTimeStore } from './one-time-store';

export const MAX_PENDING_LOGIN_CODES = 1000;
export const LOGIN_RATE_LIMIT: RateWindow = { limit: 20, windowMs: 60_000 };
export const CALLBACK_RATE_LIMIT: RateWindow = { limit: 30, windowMs: 60_000 };
export const LOGOUT_RATE_LIMIT: RateWindow = { limit: 30, windowMs: 60_000 };

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';

const callbackQuerySchema = z.object({
    code: z.string().min(1).max(2048).optional(),
    state: z.string().min(1).max(512).optional(),
    error: z.string().max(256).optional(),
});

interface VerifiedCallback {
    query?: z.infer<typeof callbackQuerySchema>;
    state?: VerifiedLoginState;
}

const roomLinkParams = (mesa?: string): Record<string, string> => (mesa ? { [ROOM_LINK_QUERY_PARAM]: mesa } : {});

interface IssuedSession {
    blob: string;
    siteUrl: string;
}

export interface LoginStart {
    url: string;
    setCookie: string;
}

export interface LoginCompletion {
    url: string;
    setCookie: string;
}

@Injectable()
export class JiraLoginService {
    private readonly logger = new Logger(JiraLoginService.name);
    private readonly codes: OneTimeStore<IssuedSession>;
    private readonly consumedStates: ConsumedNonces;
    private readonly loginLimiter: RateLimiter;
    private readonly callbackLimiter: RateLimiter;
    private readonly logoutLimiter: RateLimiter;
    private readonly signer?: LoginStateSigner;

    constructor(
        @Inject(JIRA_AUTH_CONFIG) private readonly config: JiraAuthConfig,
        private readonly client: AtlassianAuthClient,
        private readonly sessions: JiraSessionService,
        @Inject(JIRA_CLOCK) clock: Clock,
    ) {
        this.codes = new OneTimeStore({
            ttlMs: JIRA_LOGIN_CODE_TTL_MS,
            maxEntries: MAX_PENDING_LOGIN_CODES,
            clock,
        });
        this.consumedStates = new ConsumedNonces(clock);
        this.loginLimiter = new RateLimiter(LOGIN_RATE_LIMIT, { now: clock });
        this.callbackLimiter = new RateLimiter(CALLBACK_RATE_LIMIT, { now: clock });
        this.logoutLimiter = new RateLimiter(LOGOUT_RATE_LIMIT, { now: clock });
        this.signer = config.enabled ? new LoginStateSigner(config.encryptionKey, clock) : undefined;
    }

    get enabled(): boolean {
        return this.config.enabled;
    }

    limitLogout(address: string): void {
        const retryAfterMs = this.logoutLimiter.consume(address);
        if (retryAfterMs !== null) {
            throw rateLimitedError('rate_limited', retryAfterMs);
        }
    }

    beginLogin(address: string, mesa?: string): LoginStart {
        const config = this.requireEnabled();
        const retryAfterMs = this.loginLimiter.consume(address);
        if (retryAfterMs !== null) {
            throw rateLimitedError('rate_limited', retryAfterMs);
        }
        const { state, bind } = this.signer!.issue(mesa);
        const url = new URL(AUTHORIZE_URL);
        url.search = new URLSearchParams({
            audience: 'api.atlassian.com',
            client_id: config.clientId,
            scope: JIRA_OAUTH_SCOPES.join(' '),
            redirect_uri: config.redirectUri,
            state,
            response_type: 'code',
            prompt: 'consent',
        }).toString();
        return {
            url: url.toString(),
            setCookie: serializeBindCookie(bind, this.secureCookie(config)),
        };
    }

    async completeLogin(address: string, query: unknown, cookieHeader?: string): Promise<LoginCompletion> {
        const config = this.requireEnabled();
        const setCookie = clearBindCookie(this.secureCookie(config));
        const callback = this.verifyCallback(query, cookieHeader);
        if (this.callbackLimiter.consume(address) !== null) {
            return { url: this.errorRedirect('jira_login_failed', callback.state?.mesa), setCookie };
        }
        return { url: await this.resolveCallback(callback), setCookie };
    }

    redeemCode(code: string): IssuedSession {
        this.requireEnabled();
        const issued = this.codes.take(code);
        if (!issued) {
            throw jiraError('jira_login_code_invalid');
        }
        return issued;
    }

    errorRedirect(error: JiraLoginError, mesa?: string): string {
        return this.frontRedirect({ ...roomLinkParams(mesa), [JIRA_LOGIN_ERROR_QUERY_PARAM]: error });
    }

    sweep(): void {
        this.codes.sweep();
        this.consumedStates.sweep();
    }

    private verifyCallback(query: unknown, cookieHeader?: string): VerifiedCallback {
        const parsed = callbackQuerySchema.safeParse(query);
        if (!parsed.success) return {};
        const state = parsed.data.state
            ? this.signer!.verify(parsed.data.state, readBindCookie(cookieHeader))
            : undefined;
        return { query: parsed.data, state };
    }

    private async resolveCallback({ query, state }: VerifiedCallback): Promise<string> {
        if (!query || !state) {
            return this.failed('state_invalid');
        }
        if (!this.consumedStates.consume(state.nonce, state.expiresAt)) {
            return this.failed('state_reused_or_store_full', state.mesa);
        }
        if (query.error || !query.code) {
            return this.failed('consent_denied', state.mesa);
        }
        try {
            const code = await this.issueLoginCode(query.code);
            return code ? this.successRedirect(code, state.mesa) : this.failed('code_store_full', state.mesa);
        } catch (error) {
            return this.failed('exchange_failed', state.mesa, error);
        }
    }

    private async issueLoginCode(authorizationCode: string): Promise<string | undefined> {
        const tokens = await this.client.exchangeCode(authorizationCode);
        const profile = await this.client.fetchProfile(tokens.accessToken);
        const blob = this.sessions.createBlob({
            refreshToken: tokens.refreshToken,
            cloudId: profile.cloudId,
            accountId: profile.accountId,
            siteUrl: profile.siteUrl,
        });
        this.sessions.prime(blob, tokens.accessToken, tokens.expiresInMs);
        return this.codes.put({ blob, siteUrl: profile.siteUrl });
    }

    private successRedirect(code: string, mesa?: string): string {
        return this.frontRedirect({ ...roomLinkParams(mesa), [JIRA_LOGIN_CODE_QUERY_PARAM]: code });
    }

    private failed(reason: string, mesa?: string, error?: unknown): string {
        const cause = error instanceof Error ? ` (${error.name})` : '';
        this.logger.warn(`Jira login failed: ${reason}${cause}`);
        return this.errorRedirect('jira_login_failed', mesa);
    }

    private frontRedirect(params: Record<string, string>): string {
        const url = new URL('/', this.config.frontUrl);
        url.search = new URLSearchParams(params).toString();
        return url.toString();
    }

    private secureCookie(config: JiraEnabledConfig): boolean {
        return new URL(config.redirectUri).protocol === 'https:';
    }

    private requireEnabled(): JiraEnabledConfig {
        if (!this.config.enabled) {
            throw jiraError('jira_disabled');
        }
        return this.config;
    }
}
