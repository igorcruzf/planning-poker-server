import { JiraAccessGrant, JiraSessionService } from '../auth/jira-session.service';

export const SITE_URL = 'https://acme.atlassian.net';
export const CLOUD_ID = 'cloud-1';
export const API_BASE = `https://api.atlassian.com/ex/jira/${CLOUD_ID}`;

export interface RecordedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    init: RequestInit;
}

export type FakeReply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

export const reply = (status: number, body?: unknown, headers: Record<string, string> = {}): FakeReply => ({
    status,
    body,
    headers,
});

export const createFakeAtlassian = (replies: FakeReply[]) => {
    const requests: RecordedRequest[] = [];
    const queue = [...replies];
    const fetchFunction = async (url: string, init: RequestInit): Promise<Response> => {
        requests.push({
            url,
            method: init.method ?? 'GET',
            headers: init.headers as Record<string, string>,
            body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
            init,
        });
        const next = queue.shift();
        if (!next) {
            throw new Error(`unexpected request to ${url}`);
        }
        if (next instanceof Error) {
            throw next;
        }
        return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
            status: next.status,
            headers: next.headers,
        });
    };
    return { fetchFunction, requests, remaining: () => queue.length };
};

export const createFakeSessions = (forcedGrant: Partial<JiraAccessGrant> = {}) => {
    const base: JiraAccessGrant = {
        accessToken: 'access-1',
        cloudId: CLOUD_ID,
        accountId: 'account-1',
        siteUrl: SITE_URL,
    };
    const calls = { getAccessToken: 0, forceRefresh: 0 };
    const sessions = {
        getAccessToken: async () => {
            calls.getAccessToken += 1;
            return base;
        },
        forceRefresh: async () => {
            calls.forceRefresh += 1;
            return { ...base, accessToken: 'access-2', ...forcedGrant };
        },
    } as unknown as JiraSessionService;
    return { sessions, calls };
};

export const issueJson = (key: string, fields: Record<string, unknown> = {}) => ({
    key,
    fields: {
        summary: `Resumo ${key}`,
        issuetype: { name: 'Story' },
        status: { name: 'To Do' },
        assignee: { displayName: 'Ana' },
        ...fields,
    },
});

export const SIZE_FIELD_ID = 'customfield_10191';

export const sizeEditmeta = (
    options: { id: string; value: string }[] = [
        { id: '1', value: 'P' },
        { id: '2', value: 'M' },
    ],
) => ({ fields: { [SIZE_FIELD_ID]: { name: 'Size', allowedValues: options } } });
