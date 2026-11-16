import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
    JIRA_LOGIN_CODE_QUERY_PARAM,
    JIRA_LOGIN_CODE_TTL_MS,
    JIRA_LOGIN_ERROR_QUERY_PARAM,
    JIRA_OAUTH_SCOPES,
    JIRA_OAUTH_STATE_TTL_MS,
    JiraLoginError,
    ROOM_LINK_QUERY_PARAM,
} from '../../contracts';
import { AtlassianAuthClient } from './atlassian-auth.client';
import { jiraError, rateLimitedError } from './jira-app.exception';
import type { JiraAuthConfig, JiraEnabledConfig } from './jira-auth.config';
import type { Clock } from './jira-auth.tokens';
import { JIRA_AUTH_CONFIG, JIRA_CLOCK } from './jira-auth.tokens';
import { JiraSessionService } from './jira-session.service';
import { OneTimeStore } from './one-time-store';

export const MAX_PENDING_LOGINS = 1000;
export const MAX_PENDING_LOGIN_CODES = 1000;
export const LOGIN_REFUSED_RETRY_AFTER_MS = 10_000;
const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';

const callbackQuerySchema = z.object({
    code: z.string().min(1).max(2048).optional(),
    state: z.string().min(1).max(256).optional(),
    error: z.string().max(256).optional(),
});

interface PendingLogin {
    mesa?: string;
}

interface IssuedSession {
    blob: string;
    siteUrl: string;
}

@Injectable()
export class JiraLoginService {
    private readonly logger = new Logger(JiraLoginService.name);
    private readonly states: OneTimeStore<PendingLogin>;
    private readonly codes: OneTimeStore<IssuedSession>;

    constructor(
        @Inject(JIRA_AUTH_CONFIG) private readonly config: JiraAuthConfig,
        private readonly client: AtlassianAuthClient,
        private readonly sessions: JiraSessionService,
        @Inject(JIRA_CLOCK) clock: Clock,
    ) {
        this.states = new OneTimeStore({ ttlMs: JIRA_OAUTH_STATE_TTL_MS, maxEntries: MAX_PENDING_LOGINS, clock });
        this.codes = new OneTimeStore({ ttlMs: JIRA_LOGIN_CODE_TTL_MS, maxEntries: MAX_PENDING_LOGIN_CODES, clock });
    }

    get enabled(): boolean {
        return this.config.enabled;
    }

    beginLogin(mesa?: string): string {
        const config = this.requireEnabled();
        const state = this.states.put({ mesa });
        if (!state) {
            throw rateLimitedError('rate_limited', LOGIN_REFUSED_RETRY_AFTER_MS);
        }
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
        return url.toString();
    }

    async completeLogin(query: unknown): Promise<string> {
        const parsed = callbackQuerySchema.safeParse(query);
        const pending = parsed.success && parsed.data.state ? this.states.take(parsed.data.state) : undefined;
        if (!parsed.success || !pending) {
            return this.failed('state_invalid');
        }
        if (parsed.data.error || !parsed.data.code) {
            return this.failed('consent_denied');
        }
        try {
            const code = await this.issueLoginCode(parsed.data.code);
            return code ? this.successRedirect(code, pending.mesa) : this.failed('code_store_full');
        } catch (error) {
            return this.failed('exchange_failed', error);
        }
    }

    redeemCode(code: string): IssuedSession {
        this.requireEnabled();
        const issued = this.codes.take(code);
        if (!issued) {
            throw jiraError('jira_login_code_invalid');
        }
        return issued;
    }

    errorRedirect(error: JiraLoginError): string {
        return this.frontRedirect({ [JIRA_LOGIN_ERROR_QUERY_PARAM]: error });
    }

    sweep(): void {
        this.states.sweep();
        this.codes.sweep();
    }

    private async issueLoginCode(authorizationCode: string): Promise<string | undefined> {
        const tokens = await this.client.exchangeCode(authorizationCode);
        const profile = await this.client.fetchProfile(tokens.accessToken);
        const blob = this.sessions.createBlob({
            refreshToken: tokens.refreshToken,
            cloudId: profile.cloudId,
            accountId: profile.accountId,
        });
        this.sessions.prime(blob, tokens.accessToken, tokens.expiresInMs);
        return this.codes.put({ blob, siteUrl: profile.siteUrl });
    }

    private successRedirect(code: string, mesa?: string): string {
        return this.frontRedirect({
            ...(mesa ? { [ROOM_LINK_QUERY_PARAM]: mesa } : {}),
            [JIRA_LOGIN_CODE_QUERY_PARAM]: code,
        });
    }

    private failed(reason: string, error?: unknown): string {
        const cause = error instanceof Error ? ` (${error.name})` : '';
        this.logger.warn(`Jira login failed: ${reason}${cause}`);
        return this.errorRedirect('jira_login_failed');
    }

    private frontRedirect(params: Record<string, string>): string {
        const url = new URL('/', this.config.frontUrl);
        url.search = new URLSearchParams(params).toString();
        return url.toString();
    }

    private requireEnabled(): JiraEnabledConfig {
        if (!this.config.enabled) {
            throw jiraError('jira_disabled');
        }
        return this.config;
    }
}
