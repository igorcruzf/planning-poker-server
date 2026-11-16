import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { httpUrlSchema } from '../../contracts';
import { jiraError } from './jira-app.exception';
import { JiraAuthConfig, JiraEnabledConfig } from './jira-auth.config';
import { JIRA_AUTH_CONFIG, JIRA_FETCH } from './jira-auth.tokens';

export const ATLASSIAN_REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const ME_URL = 'https://api.atlassian.com/me';

export type AtlassianFailureKind = 'invalid_grant' | 'rate_limited' | 'unavailable' | 'invalid_response';

export class AtlassianAuthFailure extends Error {
    constructor(
        readonly kind: AtlassianFailureKind,
        readonly retryAfterMs?: number,
    ) {
        super(`Atlassian request failed: ${kind}`);
    }
}

export interface AtlassianTokens {
    accessToken: string;
    refreshToken: string;
    expiresInMs: number;
}

export interface AtlassianProfile {
    cloudId: string;
    siteUrl: string;
    accountId: string;
}

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

const tokenResponseSchema = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().positive(),
});
const resourcesSchema = z.array(z.object({ id: z.string().min(1), url: httpUrlSchema })).min(1);
const meSchema = z.object({ account_id: z.string().min(1) });

const GRANT_REJECTED_STATUSES = new Set([400, 401, 403]);

const parseRetryAfterMs = (header: string | null): number | undefined => {
    const seconds = Number(header);
    return header !== null && header.trim() !== '' && Number.isFinite(seconds) && seconds >= 0
        ? Math.round(seconds * 1000)
        : undefined;
};

@Injectable()
export class AtlassianAuthClient {
    constructor(
        @Inject(JIRA_AUTH_CONFIG) private readonly authConfig: JiraAuthConfig,
        @Inject(JIRA_FETCH) private readonly fetchFunction: FetchFunction,
    ) {}

    private get config(): JiraEnabledConfig {
        if (!this.authConfig.enabled) {
            throw jiraError('jira_disabled');
        }
        return this.authConfig;
    }


    async exchangeCode(code: string): Promise<AtlassianTokens> {
        return this.requestTokens({
            grant_type: 'authorization_code',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code,
            redirect_uri: this.config.redirectUri,
        });
    }

    async refresh(refreshToken: string): Promise<AtlassianTokens> {
        return this.requestTokens(
            {
                grant_type: 'refresh_token',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                refresh_token: refreshToken,
            },
            false,
        );
    }

    async fetchProfile(accessToken: string): Promise<AtlassianProfile> {
        const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
        const resources = resourcesSchema.safeParse(await this.getJson(ACCESSIBLE_RESOURCES_URL, headers));
        const me = meSchema.safeParse(await this.getJson(ME_URL, headers));
        if (!resources.success || !me.success) {
            throw new AtlassianAuthFailure('invalid_response');
        }
        const [site] = resources.data;
        return { cloudId: site.id, siteUrl: site.url, accountId: me.data.account_id };
    }

    private async requestTokens(body: Record<string, string>, requireRefreshToken = true): Promise<AtlassianTokens> {
        const json = await this.send(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
        });
        const parsed = tokenResponseSchema.safeParse(json);
        if (!parsed.success || (requireRefreshToken && !parsed.data.refresh_token)) {
            throw new AtlassianAuthFailure('invalid_response');
        }
        return {
            accessToken: parsed.data.access_token,
            refreshToken: parsed.data.refresh_token ?? body.refresh_token,
            expiresInMs: Math.round(parsed.data.expires_in * 1000),
        };
    }

    private getJson(url: string, headers: Record<string, string>): Promise<unknown> {
        return this.send(url, { method: 'GET', headers });
    }

    private async send(url: string, init: RequestInit): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetchFunction(url, { ...init, signal: AbortSignal.timeout(ATLASSIAN_REQUEST_TIMEOUT_MS) });
        } catch {
            throw new AtlassianAuthFailure('unavailable');
        }
        if (response.status === 429) {
            throw new AtlassianAuthFailure('rate_limited', parseRetryAfterMs(response.headers.get('retry-after')));
        }
        if (GRANT_REJECTED_STATUSES.has(response.status)) {
            throw new AtlassianAuthFailure('invalid_grant');
        }
        if (!response.ok) {
            throw new AtlassianAuthFailure('unavailable');
        }
        try {
            return await response.json();
        } catch {
            throw new AtlassianAuthFailure('invalid_response');
        }
    }
}
