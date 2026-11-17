import { INestApplication, LoggerService, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import { AddressInfo } from 'node:net';
import {
    ERROR_HTTP_STATUS,
    JIRA_LOGIN_CODE_TTL_MS,
    JIRA_OAUTH_SCOPES,
    JIRA_OAUTH_STATE_TTL_MS,
    JIRA_SESSION_HEADER,
    httpErrorBodySchema,
    jiraSessionResponseSchema,
} from '../../contracts';
import { AppModule } from '../../app.module';
import { JiraLoginService } from './jira-login.service';
import { jiraAuthModuleMetadata, JiraAuthModule } from './jira-auth.module';
import { JiraSessionService } from './jira-session.service';
import { JiraAuthConfig } from './jira-auth.config';
import { SessionBlobCodec } from './session-blob';

const FRONT = 'https://front.test';
const REDIRECT_URI = 'https://back.test/api/auth/jira/callback';
const CLIENT_SECRET = 'super-client-secret';
const HOUR = 3_600_000;
const MESA = 'yak-abcd2345';

class LogCollector implements LoggerService {
    readonly lines: string[] = [];
    log = (...args: unknown[]) => this.record(args);
    error = (...args: unknown[]) => this.record(args);
    warn = (...args: unknown[]) => this.record(args);
    debug = (...args: unknown[]) => this.record(args);
    verbose = (...args: unknown[]) => this.record(args);
    private record(args: unknown[]) {
        this.lines.push(args.map(String).join(' '));
    }
}

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

describe('Jira auth endpoints', () => {
    let app: INestApplication;
    let base: string;
    let now: number;
    let logs: LogCollector;
    let atlassianCalls: { url: string; body?: Record<string, string> }[];
    let refreshCount: number;
    let refreshHandler: () => Response | Promise<Response>;
    let tokenExchangeResponse: () => Response;
    let sleeps: number[];
    const encryptionKey = randomBytes(32);
    const config: JiraAuthConfig = {
        enabled: true,
        clientId: 'client-id',
        clientSecret: CLIENT_SECRET,
        encryptionKey,
        redirectUri: REDIRECT_URI,
        frontUrl: FRONT,
    };

    const fakeAtlassian = async (url: string, init: RequestInit) => {
        const body = init.body ? (JSON.parse(String(init.body)) as Record<string, string>) : undefined;
        atlassianCalls.push({ url, body });
        if (url.endsWith('/oauth/token')) {
            if (body?.grant_type === 'authorization_code') {
                return tokenExchangeResponse();
            }
            refreshCount += 1;
            return refreshHandler();
        }
        if (url.endsWith('/accessible-resources')) {
            return jsonResponse([
                {
                    id: 'cloud-1',
                    url: 'https://acme.atlassian.net',
                    scopes: ['read:jira-work'],
                },
            ]);
        }
        return jsonResponse({ account_id: 'account-1' });
    };

    const start = async (appConfig: JiraAuthConfig = config) => {
        @Module(
            jiraAuthModuleMetadata({
                config: appConfig,
                clock: () => now,
                sleep: async (ms) => void sleeps.push(ms),
                fetch: fakeAtlassian,
            }),
        )
        class TestJiraAuthModule {}
        app = await NestFactory.create(TestJiraAuthModule, { logger: logs });
        await app.listen(0, '127.0.0.1');
        base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    };

    const get = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
    const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
        fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

    const loginState = async (mesa?: string) => {
        const response = await get(`/api/auth/jira/login${mesa ? `?mesa=${mesa}` : ''}`);
        const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
        return {
            response,
            location: new URL(response.headers.get('location')!),
            cookie,
        };
    };

    const callback = async (state: string, cookie?: string, code = 'auth-code') =>
        get(`/api/auth/jira/callback?code=${code}&state=${state}`, cookie ? { headers: { Cookie: cookie } } : {});

    const loginUntilCode = async (mesa?: string) => {
        const { location, cookie } = await loginState(mesa);
        const response = await callback(location.searchParams.get('state')!, cookie);
        return new URL(response.headers.get('location')!);
    };

    const openSession = async (mesa?: string) => {
        const code = (await loginUntilCode(mesa)).searchParams.get('jira')!;
        const response = await post('/api/auth/jira/session', { code });
        return { response, blob: response.headers.get(JIRA_SESSION_HEADER)!, code };
    };

    const failedRedirect = `${FRONT}/?jira_error=jira_login_failed`;

    beforeEach(() => {
        now = 1_800_000_000_000;
        logs = new LogCollector();
        atlassianCalls = [];
        refreshCount = 0;
        sleeps = [];
        tokenExchangeResponse = () =>
            jsonResponse({
                access_token: 'AT-initial',
                refresh_token: 'RT-initial',
                expires_in: 3600,
            });
        refreshHandler = () =>
            jsonResponse({
                access_token: `AT-${refreshCount}`,
                refresh_token: `RT-${refreshCount}`,
                expires_in: 3600,
            });
    });

    afterEach(async () => {
        await app?.close();
    });

    describe('login', () => {
        it('redirects to the Atlassian authorize page with the OAuth parameters', async () => {
            await start();
            const { response, location } = await loginState();
            expect(response.status).toBe(302);
            expect(`${location.origin}${location.pathname}`).toBe('https://auth.atlassian.com/authorize');
            expect(Object.fromEntries(location.searchParams)).toMatchObject({
                audience: 'api.atlassian.com',
                client_id: 'client-id',
                scope: JIRA_OAUTH_SCOPES.join(' '),
                redirect_uri: REDIRECT_URI,
                response_type: 'code',
                prompt: 'consent',
            });
            expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
            expect(location.href).not.toContain(CLIENT_SECRET);
        });

        it('binds the login to the browser with a restricted cookie', async () => {
            await start();
            const { response, cookie } = await loginState();
            expect(cookie).toMatch(/^yak_jira_bind=[A-Za-z0-9_-]{43}$/);
            const attributes = response.headers.get('set-cookie')!.split('; ').slice(1);
            expect(attributes.sort()).toEqual([
                'HttpOnly',
                'Max-Age=600',
                'Path=/api/auth/jira',
                'SameSite=Lax',
                'Secure',
            ]);
        });

        it('omits Secure on the cookie when the redirect uri is not https', async () => {
            await start({
                ...config,
                redirectUri: 'http://localhost:3000/api/auth/jira/callback',
            });
            const { response } = await loginState();
            expect(response.headers.get('set-cookie')).not.toContain('Secure');
        });

        it('does not allocate state for anonymous logins', async () => {
            await start();
            for (let index = 0; index < 1200; index += 1) {
                app.get(JiraLoginService).beginLogin();
            }
            const front = await loginUntilCode();
            expect(front.searchParams.get('jira')).toBeTruthy();
        });

        it('rejects an invalid mesa with the schema error', async () => {
            await start();
            const response = await get('/api/auth/jira/login?mesa=nao-e-codigo');
            expect(response.status).toBe(ERROR_HTTP_STATUS.invalid_payload);
            expect(httpErrorBodySchema.parse(await response.json()).error.code).toBe('invalid_payload');
        });
    });

    describe('cache headers', () => {
        it('marks every endpoint response as no-store', async () => {
            await start();
            const { response, location, cookie } = await loginState();
            const callbackResponse = await callback(location.searchParams.get('state')!, cookie);
            const code = new URL(callbackResponse.headers.get('location')!).searchParams.get('jira')!;
            const session = await post('/api/auth/jira/session', { code });
            const blob = session.headers.get(JIRA_SESSION_HEADER)!;
            const logout = await post('/api/auth/jira/logout', undefined, {
                Authorization: `Bearer ${blob}`,
            });
            const status = await get('/api/jira/status');
            for (const each of [response, callbackResponse, session, logout, status]) {
                expect(each.headers.get('cache-control')).toBe('no-store');
            }
        });

        it('marks the disabled redirects as no-store', async () => {
            await start({ enabled: false, frontUrl: FRONT });
            expect((await get('/api/auth/jira/login')).headers.get('cache-control')).toBe('no-store');
            expect((await get('/api/auth/jira/callback')).headers.get('cache-control')).toBe('no-store');
        });
    });

    describe('happy path', () => {
        it.each([
            ['with a mesa', MESA],
            ['without a mesa', undefined],
        ])('runs login, callback, session and renewal %s', async (_, mesa) => {
            await start();
            const front = await loginUntilCode(mesa);
            expect(`${front.origin}${front.pathname}`).toBe(`${FRONT}/`);
            expect(front.searchParams.get('mesa')).toBe(mesa ?? null);
            const loginCode = front.searchParams.get('jira')!;
            expect(loginCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect([...front.searchParams.keys()].sort()).toEqual(mesa ? ['jira', 'mesa'] : ['jira']);

            const session = await post('/api/auth/jira/session', { code: loginCode });
            expect(session.status).toBe(200);
            const body = await session.json();
            expect(jiraSessionResponseSchema.parse(body)).toEqual({
                siteUrl: 'https://acme.atlassian.net',
            });
            expect(Object.keys(body)).toEqual(['siteUrl']);
            const blob = session.headers.get(JIRA_SESSION_HEADER)!;
            expect(blob).toBeTruthy();

            const sessions = app.get(JiraSessionService);
            await expect(sessions.getAccessToken(blob)).resolves.toEqual({
                accessToken: 'AT-initial',
                cloudId: 'cloud-1',
                accountId: 'account-1',
                siteUrl: 'https://acme.atlassian.net',
            });
            expect(refreshCount).toBe(0);

            now += HOUR;
            const renewed = await sessions.getAccessToken(blob);
            expect(renewed).toMatchObject({
                accessToken: 'AT-1',
                cloudId: 'cloud-1',
                accountId: 'account-1',
            });
            const codec = new SessionBlobCodec(encryptionKey);
            expect(codec.decode(renewed.refreshedBlob!).refreshToken).toBe('RT-1');
            expect(atlassianCalls.find((call) => call.body?.grant_type === 'refresh_token')?.body?.refresh_token).toBe(
                'RT-initial',
            );
        });

        it('exchanges the code with the secret only in the Atlassian request', async () => {
            await start();
            await openSession();
            const exchange = atlassianCalls.find((call) => call.body?.grant_type === 'authorization_code');
            expect(exchange?.body).toMatchObject({
                client_secret: CLIENT_SECRET,
                code: 'auth-code',
                redirect_uri: REDIRECT_URI,
            });
        });
    });

    describe('callback state', () => {
        const expectFailed = async (response: Response) => {
            expect(response.status).toBe(302);
            expect(response.headers.get('location')).toBe(failedRedirect);
        };

        it.each([
            ['unknown', '/api/auth/jira/callback?code=c&state=desconhecido'],
            ['missing', '/api/auth/jira/callback?code=c'],
            ['absent query', '/api/auth/jira/callback'],
        ])('redirects with jira_login_failed for a %s state without calling Atlassian', async (_, path) => {
            await start();
            await expectFailed(await get(path));
            expect(atlassianCalls).toEqual([]);
        });

        it('rejects an expired state', async () => {
            await start();
            const { location, cookie } = await loginState();
            now += JIRA_OAUTH_STATE_TTL_MS;
            await expectFailed(await callback(location.searchParams.get('state')!, cookie));
            expect(atlassianCalls).toEqual([]);
        });

        it('rejects a reused state even when the browser sends the cookie again', async () => {
            await start();
            const { location, cookie } = await loginState();
            const state = location.searchParams.get('state')!;
            expect((await callback(state, cookie)).headers.get('location')).not.toBe(failedRedirect);
            atlassianCalls.length = 0;
            await expectFailed(await callback(state, cookie));
            expect(atlassianCalls).toEqual([]);
        });

        it('fails and burns the state when the user denies consent', async () => {
            await start();
            const { location, cookie } = await loginState();
            const state = location.searchParams.get('state')!;
            await expectFailed(
                await get(`/api/auth/jira/callback?error=access_denied&state=${state}`, {
                    headers: { Cookie: cookie },
                }),
            );
            await expectFailed(await callback(state, cookie));
            expect(atlassianCalls).toEqual([]);
        });

        it('fails when the token exchange fails', async () => {
            await start();
            tokenExchangeResponse = () => jsonResponse({ error: 'invalid_grant' }, 400);
            const { location, cookie } = await loginState();
            await expectFailed(await callback(location.searchParams.get('state')!, cookie));
        });

        it('rejects repeated or non-string query parameters', async () => {
            await start();
            const { location, cookie } = await loginState();
            const state = location.searchParams.get('state')!;
            await expectFailed(
                await get(`/api/auth/jira/callback?code=a&code=b&state=${state}`, {
                    headers: { Cookie: cookie },
                }),
            );
        });

        it('rejects a callback from a browser that did not start the login (login CSRF)', async () => {
            await start();
            const attacker = await loginState();
            const victim = await loginState();
            const state = attacker.location.searchParams.get('state')!;
            await expectFailed(await callback(state));
            await expectFailed(await callback(state, victim.cookie));
            await expectFailed(await callback(state, 'yak_jira_bind=forjado'));
            expect(atlassianCalls).toEqual([]);
        });

        it('still accepts the legitimate browser after a failed attempt with a wrong cookie', async () => {
            await start();
            const { location, cookie } = await loginState();
            const state = location.searchParams.get('state')!;
            await expectFailed(await callback(state));
            expect((await callback(state, cookie)).headers.get('location')).not.toBe(failedRedirect);
        });

        it('rejects a state signed with a forged payload', async () => {
            await start();
            const { location, cookie } = await loginState(MESA);
            const [, signature] = location.searchParams.get('state')!.split('.');
            const forged = Buffer.from(JSON.stringify({ n: 'x', exp: now + 1_000_000, b: 'x' })).toString('base64url');
            await expectFailed(await callback(`${forged}.${signature}`, cookie));
            expect(atlassianCalls).toEqual([]);
        });

        it('clears the bind cookie on the callback', async () => {
            await start();
            const { location, cookie } = await loginState();
            const response = await callback(location.searchParams.get('state')!, cookie);
            expect(response.headers.get('set-cookie')).toMatch(/^yak_jira_bind=; .*Max-Age=0/);
        });
    });

    describe('session', () => {
        it('rejects a reused login code', async () => {
            await start();
            const { code } = await openSession();
            const reused = await post('/api/auth/jira/session', { code });
            expect(reused.status).toBe(400);
            expect(httpErrorBodySchema.parse(await reused.json())).toEqual({
                error: { code: 'jira_login_code_invalid' },
            });
            expect(reused.headers.get(JIRA_SESSION_HEADER)).toBeNull();
        });

        it('rejects an expired login code', async () => {
            await start();
            const code = (await loginUntilCode()).searchParams.get('jira')!;
            now += JIRA_LOGIN_CODE_TTL_MS;
            const response = await post('/api/auth/jira/session', { code });
            expect(response.status).toBe(400);
            expect((await response.json()).error.code).toBe('jira_login_code_invalid');
        });

        it.each([
            ['unknown', { code: randomBytes(32).toString('base64url') }],
            ['malformed', { code: 'x' }],
            ['missing', {}],
            ['with extra fields', { code: randomBytes(32).toString('base64url'), extra: 1 }],
        ])('rejects a %s code with jira_login_code_invalid', async (_, body) => {
            await start();
            const response = await post('/api/auth/jira/session', body);
            expect(response.status).toBe(400);
            expect((await response.json()).error.code).toBe('jira_login_code_invalid');
        });

        it('rejects a request without body', async () => {
            await start();
            expect((await post('/api/auth/jira/session')).status).toBe(400);
        });
    });

    describe('logout', () => {
        it('answers 204 and revokes the blob', async () => {
            await start();
            const { blob } = await openSession();
            const response = await post('/api/auth/jira/logout', undefined, {
                Authorization: `Bearer ${blob}`,
            });
            expect(response.status).toBe(204);
            await expect(app.get(JiraSessionService).getAccessToken(blob)).rejects.toMatchObject({
                error: { code: 'jira_reconnect_required' },
            });
            expect(refreshCount).toBe(0);
        });

        it.each([
            ['without header', {}],
            ['with garbage', { Authorization: 'Bearer lixo' }],
            ['with another scheme', { Authorization: 'Basic abc' }],
        ])('is idempotent and silent %s', async (_, headers) => {
            await start();
            expect((await post('/api/auth/jira/logout', undefined, headers)).status).toBe(204);
        });
    });

    describe('status', () => {
        it('reports Jira as enabled', async () => {
            await start();
            const response = await get('/api/jira/status');
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ enabled: true });
        });
    });

    describe('when Jira is disabled', () => {
        const disabled: JiraAuthConfig = { enabled: false, frontUrl: FRONT };

        it('redirects login to the front with jira_disabled', async () => {
            await start(disabled);
            const response = await get('/api/auth/jira/login');
            expect(response.status).toBe(302);
            expect(response.headers.get('location')).toBe(`${FRONT}/?jira_error=jira_disabled`);
        });

        it('redirects callback with jira_disabled', async () => {
            await start(disabled);
            const response = await get('/api/auth/jira/callback?code=c&state=s');
            expect(response.headers.get('location')).toBe(`${FRONT}/?jira_error=jira_disabled`);
        });

        it.each(['/api/auth/jira/session', '/api/auth/jira/logout'])('answers jira_disabled on %s', async (path) => {
            await start(disabled);
            const response = await post(path, {
                code: randomBytes(32).toString('base64url'),
            });
            expect(response.status).toBe(503);
            expect(await response.json()).toEqual({
                error: { code: 'jira_disabled' },
            });
        });

        it('reports status disabled', async () => {
            await start(disabled);
            expect(await (await get('/api/jira/status')).json()).toEqual({
                enabled: false,
            });
        });

        it('lets the AppModule boot without the Jira variables', async () => {
            const saved = { ...process.env };
            delete process.env.JIRA_CLIENT_ID;
            delete process.env.JIRA_CLIENT_SECRET;
            delete process.env.SESSION_ENC_KEY;
            try {
                const full = await NestFactory.create(AppModule, { logger: false });
                await full.listen(0, '127.0.0.1');
                const port = (full.getHttpServer().address() as AddressInfo).port;
                const status = await fetch(`http://127.0.0.1:${port}/api/jira/status`);
                expect(await status.json()).toEqual({ enabled: false });
                expect(() => full.select(JiraAuthModule)).not.toThrow();
                await full.close();
            } finally {
                process.env = saved;
            }
        });
    });

    describe('secrets', () => {
        it('keeps tokens, secrets, codes and blobs out of logs, URLs and bodies on every scenario', async () => {
            await start();
            const seen: string[] = [];
            const track = async (response: Response) => {
                seen.push(response.headers.get('location') ?? '', await response.clone().text());
                response.headers.forEach((value, name) => {
                    if (name.toLowerCase() !== JIRA_SESSION_HEADER.toLowerCase()) {
                        seen.push(value);
                    }
                });
            };
            const { location, cookie } = await loginState(MESA);
            const bind = cookie.split('=')[1];
            const state = location.searchParams.get('state')!;
            const callbackResponse = await callback(state, cookie);
            await track(callbackResponse);
            const code = new URL(callbackResponse.headers.get('location')!).searchParams.get('jira')!;
            const session = await post('/api/auth/jira/session', { code });
            await track(session);
            const blob = session.headers.get(JIRA_SESSION_HEADER)!;
            await track(await post('/api/auth/jira/session', { code }));
            await track(await callback(state, cookie));
            tokenExchangeResponse = () => jsonResponse({ error: 'invalid_grant', refresh_token: 'RT-initial' }, 400);
            const another = await loginState();
            await track(await callback(another.location.searchParams.get('state')!, another.cookie));
            refreshHandler = () => jsonResponse({ error: 'invalid_grant', refresh_token: 'RT-initial' }, 400);
            now += HOUR;
            await app
                .get(JiraSessionService)
                .getAccessToken(blob)
                .catch((error) => seen.push(JSON.stringify(error.response)));
            await track(
                await post('/api/auth/jira/logout', undefined, {
                    Authorization: `Bearer ${blob}`,
                }),
            );
            await track(await get('/api/auth/jira/login?mesa=ruim'));

            const tokens = [
                CLIENT_SECRET,
                'AT-initial',
                'RT-initial',
                'AT-1',
                'RT-1',
                'refresh_token',
                'access_token',
                'client_secret',
            ];
            const logText = logs.lines.join('\n');
            const responseText = seen.join('\n');
            for (const secret of [...tokens, blob, code, state, bind]) {
                expect(logText).not.toContain(secret);
            }
            for (const secret of [...tokens, blob]) {
                expect(responseText).not.toContain(secret);
            }
        });
    });
});
