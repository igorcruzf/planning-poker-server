import { AtlassianAuthClient, AtlassianAuthFailure } from './atlassian-auth.client';
import { JiraEnabledConfig } from './jira-auth.config';

const config = {
    enabled: true,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://back.test/cb',
} as JiraEnabledConfig;

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const tokens = { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 };

const site = (id: string, url: string, scopes: string[] = ['read:jira-work', 'write:jira-work']) => ({
    id,
    url,
    name: id,
    scopes,
});
const failureOf = async (promise: Promise<unknown>): Promise<AtlassianAuthFailure> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(AtlassianAuthFailure);
        return error as AtlassianAuthFailure;
    }
    throw new Error('expected failure');
};

describe('AtlassianAuthClient', () => {
    let fetchMock: jest.Mock;
    let client: AtlassianAuthClient;

    beforeEach(() => {
        fetchMock = jest.fn();
        client = new AtlassianAuthClient(config, fetchMock);
    });

    it('exchanges the code at the token endpoint', async () => {
        fetchMock.mockResolvedValue(jsonResponse(tokens));
        await expect(client.exchangeCode('the-code')).resolves.toEqual({
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresInMs: 3_600_000,
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://auth.atlassian.com/oauth/token');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            grant_type: 'authorization_code',
            client_id: 'client-id',
            client_secret: 'client-secret',
            code: 'the-code',
            redirect_uri: 'https://back.test/cb',
        });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('refreshes with the refresh token grant', async () => {
        fetchMock.mockResolvedValue(jsonResponse(tokens));
        await client.refresh('old-refresh');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            grant_type: 'refresh_token',
            client_id: 'client-id',
            client_secret: 'client-secret',
            refresh_token: 'old-refresh',
        });
    });

    it('discovers cloud, site and account', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse([site('cloud-1', 'https://acme.atlassian.net')]))
            .mockResolvedValueOnce(jsonResponse({ account_id: 'account-1' }));
        await expect(client.fetchProfile('access-1')).resolves.toEqual({
            cloudId: 'cloud-1',
            siteUrl: 'https://acme.atlassian.net',
            accountId: 'account-1',
        });
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.atlassian.com/oauth/token/accessible-resources');
        expect(fetchMock.mock.calls[1][0]).toBe('https://api.atlassian.com/me');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer access-1');
    });

    it('ignores sites without the Jira scope and picks the first eligible one by url', async () => {
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse([
                    site('wiki', 'https://a-wiki.atlassian.net', ['read:confluence-content.all']),
                    site('cloud-z', 'https://zeta.atlassian.net'),
                    site('cloud-b', 'https://beta.atlassian.net'),
                ]),
            )
            .mockResolvedValueOnce(jsonResponse({ account_id: 'account-1' }));
        await expect(client.fetchProfile('access-1')).resolves.toMatchObject({
            cloudId: 'cloud-b',
            siteUrl: 'https://beta.atlassian.net',
        });
    });
    it('fails when no site has the Jira scope', async () => {
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse([site('wiki', 'https://a.atlassian.net', ['read:confluence-content.all'])]),
            )
            .mockResolvedValueOnce(jsonResponse({ account_id: 'a' }));
        expect((await failureOf(client.fetchProfile('access-1'))).kind).toBe('invalid_response');
    });
    it('refuses to follow redirects', async () => {
        fetchMock.mockResolvedValue(jsonResponse(tokens));
        await client.exchangeCode('c');
        expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    });
    it('fails when there is no accessible site', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse({ account_id: 'a' }));
        expect((await failureOf(client.fetchProfile('access-1'))).kind).toBe('invalid_response');
    });

    it.each([400, 401, 403])('classifies %s as an invalid grant', async (status) => {
        fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, { status }));
        expect((await failureOf(client.refresh('r'))).kind).toBe('invalid_grant');
    });

    it('classifies 429 with the retry-after header', async () => {
        fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '7' } }));
        const failure = await failureOf(client.refresh('r'));
        expect(failure).toMatchObject({ kind: 'rate_limited', retryAfterMs: 7000 });
    });

    it('classifies 429 without a usable retry-after', async () => {
        fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': 'soon' } }));
        expect((await failureOf(client.refresh('r'))).retryAfterMs).toBeUndefined();
    });

    it('classifies 5xx and network errors as unavailable', async () => {
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
        expect((await failureOf(client.refresh('r'))).kind).toBe('unavailable');
        fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
        expect((await failureOf(client.refresh('r'))).kind).toBe('unavailable');
    });

    it('classifies a malformed success body as an invalid response without echoing it', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ access_token: 'leaked-access-token' }));
        const failure = await failureOf(client.refresh('r'));
        expect(failure.kind).toBe('invalid_response');
        expect(failure.message).not.toContain('leaked-access-token');
    });

    it('refuses to call Atlassian when Jira is disabled', async () => {
        const disabled = new AtlassianAuthClient({ enabled: false, frontUrl: 'https://front.test' }, fetchMock);
        await expect(disabled.refresh('r')).rejects.toMatchObject({ code: 'jira_disabled' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never puts secrets in the failure message', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: 'bad', refresh_token: 'refresh-leak' }, { status: 400 }));
        const failure = await failureOf(client.exchangeCode('code-leak'));
        expect(failure.message).not.toMatch(/refresh-leak|code-leak|client-secret/);
    });
});
