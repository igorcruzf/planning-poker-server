import { randomBytes } from 'node:crypto';
import { AtlassianAuthClient, AtlassianAuthFailure } from './atlassian-auth.client';
import { JiraAppException } from './jira-app.exception';
import { JiraAuthConfig, JiraEnabledConfig } from './jira-auth.config';
import { JiraSessionService, parseBearerBlob, TOKEN_EXPIRY_MARGIN_MS } from './jira-session.service';
import { SessionBlobCodec, SessionPayload } from './session-blob';

const key = randomBytes(32);
const enabledConfig = {
    enabled: true,
    encryptionKey: key,
} as JiraEnabledConfig;
const payload: SessionPayload = {
    v: 1,
    refreshToken: 'refresh-0',
    cloudId: 'cloud',
    accountId: 'account',
    siteUrl: 'https://acme.atlassian.net',
    issuedAt: 0,
};
const HOUR = 3_600_000;

const errorOf = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(JiraAppException);
        return (error as JiraAppException).error;
    }
    throw new Error('expected rejection');
};

describe('parseBearerBlob', () => {
    it('extracts the blob from a Bearer header', () => {
        expect(parseBearerBlob('Bearer abc_DEF-123')).toBe('abc_DEF-123');
    });

    it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer inválido!'])(
        'returns undefined for %p',
        (header) => {
            expect(parseBearerBlob(header)).toBeUndefined();
        },
    );
});

describe('JiraSessionService', () => {
    let now: number;
    let client: { refresh: jest.Mock };
    let sleep: jest.Mock;
    let codec: SessionBlobCodec;
    let blob: string;

    const createService = (config: JiraAuthConfig = enabledConfig) =>
        new JiraSessionService(config, client as unknown as AtlassianAuthClient, () => now, sleep);

    const tokens = (n: number, expiresInMs = HOUR) => ({
        accessToken: `access-${n}`,
        refreshToken: `refresh-${n}`,
        expiresInMs,
    });

    beforeEach(() => {
        now = 1_000_000;
        client = { refresh: jest.fn() };
        sleep = jest.fn().mockResolvedValue(undefined);
        codec = new SessionBlobCodec(key);
        blob = codec.encode(payload);
    });

    it('serves the primed access token from the cache without calling Atlassian', async () => {
        const service = createService();
        service.prime(blob, 'access-0', HOUR);
        await expect(service.getAccessToken(blob)).resolves.toEqual({
            accessToken: 'access-0',
            cloudId: 'cloud',
            accountId: 'account',
            siteUrl: 'https://acme.atlassian.net',
        });
        expect(client.refresh).not.toHaveBeenCalled();
    });

    it('renews before the real expiry using the safety margin', async () => {
        client.refresh.mockResolvedValue(tokens(1));
        const service = createService();
        service.prime(blob, 'access-0', HOUR);
        now += HOUR - TOKEN_EXPIRY_MARGIN_MS - 1;
        await service.getAccessToken(blob);
        expect(client.refresh).not.toHaveBeenCalled();
        now += 1;
        await expect(service.getAccessToken(blob)).resolves.toMatchObject({
            accessToken: 'access-1',
        });
        expect(client.refresh).toHaveBeenCalledWith('refresh-0');
    });

    it('returns the rotated blob and keeps serving both blobs from the cache', async () => {
        client.refresh.mockResolvedValue(tokens(1));
        const service = createService();
        const renewed = await service.getAccessToken(blob);
        expect(renewed.refreshedBlob).toBeDefined();
        expect(codec.decode(renewed.refreshedBlob!)).toMatchObject({
            refreshToken: 'refresh-1',
            cloudId: 'cloud',
            accountId: 'account',
            siteUrl: 'https://acme.atlassian.net',
            issuedAt: now,
        });
        await expect(service.getAccessToken(renewed.refreshedBlob!)).resolves.toEqual({
            accessToken: 'access-1',
            cloudId: 'cloud',
            accountId: 'account',
            siteUrl: 'https://acme.atlassian.net',
        });
        await expect(service.getAccessToken(blob)).resolves.toMatchObject({
            accessToken: 'access-1',
            refreshedBlob: renewed.refreshedBlob,
        });
        expect(client.refresh).toHaveBeenCalledTimes(1);
    });

    it('renews an old blob through its successor refresh token', async () => {
        client.refresh.mockResolvedValueOnce(tokens(1)).mockResolvedValueOnce(tokens(2));
        const service = createService();
        const first = await service.getAccessToken(blob);
        now += HOUR;
        const second = await service.getAccessToken(blob);
        expect(client.refresh).toHaveBeenNthCalledWith(2, 'refresh-1');
        expect(codec.decode(second.refreshedBlob!).refreshToken).toBe('refresh-2');
        await expect(service.getAccessToken(first.refreshedBlob!)).resolves.toMatchObject({
            accessToken: 'access-2',
            refreshedBlob: second.refreshedBlob,
        });
    });

    it('does not mint a new blob when Atlassian keeps the refresh token', async () => {
        client.refresh.mockResolvedValue({
            ...tokens(1),
            refreshToken: 'refresh-0',
        });
        const result = await createService().getAccessToken(blob);
        expect(result).toEqual({
            accessToken: 'access-1',
            cloudId: 'cloud',
            accountId: 'account',
            siteUrl: 'https://acme.atlassian.net',
        });
    });

    it('runs a single renewal for simultaneous calls with the same blob', async () => {
        let release!: (value: ReturnType<typeof tokens>) => void;
        client.refresh.mockReturnValue(new Promise((resolve) => (release = resolve)));
        const service = createService();
        const calls = Array.from({ length: 10 }, () => service.getAccessToken(blob));
        release(tokens(1));
        const results = await Promise.all(calls);
        expect(client.refresh).toHaveBeenCalledTimes(1);
        expect(new Set(results.map((result) => result.accessToken))).toEqual(new Set(['access-1']));
        expect(new Set(results.map((result) => result.refreshedBlob)).size).toBe(1);
    });

    it('rejects every simultaneous call when the renewal fails and clears the cache', async () => {
        let fail!: (reason: unknown) => void;
        client.refresh.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
        const service = createService();
        service.prime(blob, 'access-0', 0);
        const calls = Array.from({ length: 10 }, () => errorOf(service.getAccessToken(blob)));
        fail(new AtlassianAuthFailure('invalid_grant'));
        for (const error of await Promise.all(calls)) {
            expect(error.code).toBe('jira_reconnect_required');
        }
        expect(client.refresh).toHaveBeenCalledTimes(1);
        client.refresh.mockResolvedValueOnce(tokens(1));
        await expect(service.getAccessToken(blob)).resolves.toMatchObject({
            accessToken: 'access-1',
        });
        expect(client.refresh).toHaveBeenCalledTimes(2);
    });

    it('retries 429 with exponential backoff without waiting for real', async () => {
        client.refresh
            .mockRejectedValueOnce(new AtlassianAuthFailure('rate_limited'))
            .mockRejectedValueOnce(new AtlassianAuthFailure('rate_limited'))
            .mockResolvedValueOnce(tokens(1));
        await expect(createService().getAccessToken(blob)).resolves.toMatchObject({
            accessToken: 'access-1',
        });
        expect(sleep.mock.calls).toEqual([[500], [1000]]);
    });

    it('honors a longer retry-after within the cap', async () => {
        client.refresh
            .mockRejectedValueOnce(new AtlassianAuthFailure('rate_limited', 3000))
            .mockRejectedValueOnce(new AtlassianAuthFailure('rate_limited', 60_000))
            .mockResolvedValueOnce(tokens(1));
        await createService().getAccessToken(blob);
        expect(sleep.mock.calls).toEqual([[3000], [8000]]);
    });

    it('gives up after three attempts with jira_rate_limited', async () => {
        client.refresh.mockRejectedValue(new AtlassianAuthFailure('rate_limited'));
        const error = await errorOf(createService().getAccessToken(blob));
        expect(error).toEqual({ code: 'jira_rate_limited', retryAfterMs: 2000 });
        expect(client.refresh).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it.each(['unavailable', 'invalid_response'] as const)('maps %s to jira_unavailable', async (kind) => {
        client.refresh.mockRejectedValue(new AtlassianAuthFailure(kind));
        expect((await errorOf(createService().getAccessToken(blob))).code).toBe('jira_unavailable');
    });

    it('maps unexpected errors to jira_unavailable', async () => {
        client.refresh.mockRejectedValue(new Error('boom'));
        expect((await errorOf(createService().getAccessToken(blob))).code).toBe('jira_unavailable');
    });

    it('requires reconnect for an invalid blob without calling Atlassian', async () => {
        expect((await errorOf(createService().getAccessToken('garbage'))).code).toBe('jira_reconnect_required');
        expect(client.refresh).not.toHaveBeenCalled();
    });

    it('drops the cached token on logout and tolerates invalid blobs', async () => {
        client.refresh.mockResolvedValue(tokens(1));
        const service = createService();
        service.prime(blob, 'access-0', HOUR);
        service.logout(blob);
        expect(() => service.logout('garbage')).not.toThrow();
        await service.getAccessToken(blob);
        expect(client.refresh).toHaveBeenCalledTimes(1);
    });

    it('drops the successor blob from the cache on logout', async () => {
        client.refresh.mockResolvedValue(tokens(1));
        const service = createService();
        const { refreshedBlob } = await service.getAccessToken(blob);
        service.logout(blob);
        client.refresh.mockResolvedValue(tokens(2));
        await expect(service.getAccessToken(refreshedBlob!)).resolves.toMatchObject({ accessToken: 'access-2' });
    });

    it('answers jira_disabled when Jira is not configured', async () => {
        const service = createService({
            enabled: false,
            frontUrl: 'https://front.test',
        });
        expect((await errorOf(service.getAccessToken(blob))).code).toBe('jira_disabled');
        expect(() => service.logout(blob)).toThrow(JiraAppException);
    });

    it('does not resurrect a session that logged out during a renewal', async () => {
        let release!: (value: ReturnType<typeof tokens>) => void;
        client.refresh.mockReturnValue(new Promise((resolve) => (release = resolve)));
        const service = createService();
        const pending = errorOf(service.getAccessToken(blob));
        service.logout(blob);
        release(tokens(1));
        expect((await pending).code).toBe('jira_reconnect_required');
        expect(service.size).toBe(0);
    });

    it('keeps the session when the renewal fails for a transient reason', async () => {
        client.refresh.mockRejectedValueOnce(new AtlassianAuthFailure('unavailable'));
        const service = createService();
        await errorOf(service.getAccessToken(blob));
        expect(service.size).toBe(1);
        client.refresh.mockResolvedValueOnce(tokens(1));
        await expect(service.getAccessToken(blob)).resolves.toMatchObject({
            accessToken: 'access-1',
        });
    });

    it('forces a renewal even with a usable cached token', async () => {
        client.refresh.mockResolvedValue(tokens(1));
        const service = createService();
        service.prime(blob, 'access-0', HOUR);
        await expect(service.forceRefresh(blob)).resolves.toMatchObject({
            accessToken: 'access-1',
            siteUrl: 'https://acme.atlassian.net',
        });
        expect(client.refresh).toHaveBeenCalledTimes(1);
    });

    it('shares the in-flight renewal with a forced refresh', async () => {
        let release!: (value: ReturnType<typeof tokens>) => void;
        client.refresh.mockReturnValue(new Promise((resolve) => (release = resolve)));
        const service = createService();
        const calls = [service.getAccessToken(blob), service.forceRefresh(blob)];
        release(tokens(1));
        await Promise.all(calls);
        expect(client.refresh).toHaveBeenCalledTimes(1);
    });

    it('sweeps entries that were idle past the retention window', async () => {
        client.refresh.mockResolvedValue(tokens(1));
        const service = createService();
        await service.getAccessToken(blob);
        expect(service.size).toBe(2);
        now += 11 * 60 * 1000 + HOUR;
        service.sweep();
        expect(service.size).toBe(0);
    });
});
