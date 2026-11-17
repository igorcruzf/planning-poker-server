import { Inject, Injectable } from '@nestjs/common';
import type { FetchFunction } from '../auth/atlassian-auth.client';
import { JiraAppException, jiraError, rateLimitedError } from '../auth/jira-app.exception';
import type { Sleep } from '../auth/jira-auth.tokens';
import { JIRA_FETCH, JIRA_SLEEP } from '../auth/jira-auth.tokens';
import {
    JiraAccessGrant,
    JiraSessionService,
    RATE_LIMIT_BASE_DELAY_MS,
    RATE_LIMIT_MAX_ATTEMPTS,
    RATE_LIMIT_MAX_DELAY_MS,
} from '../auth/jira-session.service';
import { JiraCallContext, JiraSite } from './jira-call';

export const JIRA_API_TIMEOUT_MS = 10_000;
const API_ORIGIN = 'https://api.atlassian.com/ex/jira';

export interface JiraRequest {
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    query?: Record<string, string>;
    body?: unknown;
    onBadRequest: () => JiraAppException;
}

const parseRetryAfterMs = (header: string | null): number | undefined => {
    const seconds = Number(header);
    return header !== null && header.trim() !== '' && Number.isFinite(seconds) && seconds > 0
        ? Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.round(seconds * 1000))
        : undefined;
};

const backoffMs = (attempt: number): number =>
    Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1), RATE_LIMIT_MAX_DELAY_MS);

@Injectable()
export class JiraTransport {
    constructor(
        private readonly sessions: JiraSessionService,
        @Inject(JIRA_FETCH) private readonly fetchFunction: FetchFunction,
        @Inject(JIRA_SLEEP) private readonly sleep: Sleep,
    ) {}

    async siteOf(call: JiraCallContext): Promise<JiraSite> {
        return this.remember(call, await this.sessions.getAccessToken(call.blob));
    }

    async send(call: JiraCallContext, request: JiraRequest): Promise<unknown> {
        let grant = await this.sessions.getAccessToken(call.blob);
        let refreshed = false;
        let rateLimitedAttempts = 0;
        for (;;) {
            this.remember(call, grant);
            const response = await this.fetchOnce(grant, request);
            if (response.ok) {
                return this.readBody(response);
            }
            if (response.status === 401 && !refreshed) {
                refreshed = true;
                grant = await this.sessions.forceRefresh(call.blob);
                continue;
            }
            if (response.status === 429) {
                rateLimitedAttempts += 1;
                const delay = parseRetryAfterMs(response.headers.get('retry-after')) ?? backoffMs(rateLimitedAttempts);
                if (rateLimitedAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
                    throw rateLimitedError('jira_rate_limited', delay);
                }
                await this.sleep(delay);
                continue;
            }
            throw this.errorFor(response.status, request);
        }
    }

    private remember(call: JiraCallContext, grant: JiraAccessGrant): JiraSite {
        call.refreshedBlob = grant.refreshedBlob ?? call.refreshedBlob;
        call.site = { cloudId: grant.cloudId, siteUrl: grant.siteUrl };
        return call.site;
    }

    private async fetchOnce(grant: JiraAccessGrant, request: JiraRequest): Promise<Response> {
        const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : '';
        const hasBody = request.body !== undefined;
        try {
            return await this.fetchFunction(`${API_ORIGIN}/${grant.cloudId}${request.path}${query}`, {
                method: request.method,
                headers: {
                    Authorization: `Bearer ${grant.accessToken}`,
                    Accept: 'application/json',
                    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
                },
                body: hasBody ? JSON.stringify(request.body) : undefined,
                redirect: 'error',
                signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
            });
        } catch {
            throw jiraError('jira_unavailable');
        }
    }

    private async readBody(response: Response): Promise<unknown> {
        if (response.status === 204) {
            return undefined;
        }
        try {
            return await response.json();
        } catch {
            throw jiraError('jira_unavailable');
        }
    }

    private errorFor(status: number, request: JiraRequest): JiraAppException {
        switch (status) {
            case 400:
                return request.onBadRequest();
            case 401:
                return jiraError('jira_reconnect_required');
            case 403:
                return jiraError('jira_forbidden');
            case 404:
                return jiraError('jira_issue_not_found');
            default:
                return jiraError('jira_unavailable');
        }
    }
}
