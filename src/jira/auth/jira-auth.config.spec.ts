import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { JIRA_PRODUCTION_CALLBACK_URL } from '../../contracts';
import { loadJiraAuthConfig } from './jira-auth.config';

const DEFAULT_FRONT = 'https://yak-planning-poker.onrender.com';
const key = randomBytes(32).toString('base64');
const complete = { JIRA_CLIENT_ID: 'id', JIRA_CLIENT_SECRET: 'secret', SESSION_ENC_KEY: key };

describe('loadJiraAuthConfig', () => {
    it('enables Jira with the three required variables and the defaults', () => {
        const config = loadJiraAuthConfig(complete);
        expect(config).toMatchObject({
            enabled: true,
            clientId: 'id',
            clientSecret: 'secret',
            redirectUri: JIRA_PRODUCTION_CALLBACK_URL,
            frontUrl: 'https://yak-planning-poker.onrender.com',
        });
        expect(config.enabled && config.encryptionKey.equals(Buffer.from(key, 'base64'))).toBe(true);
    });

    it('uses the first CORS origin as default front', () => {
        expect(loadJiraAuthConfig({ CORS_ORIGIN: 'https://a.app, https://b.app' }).frontUrl).toBe('https://a.app');
    });

    it('falls back to the published front when CORS is a wildcard', () => {
        expect(loadJiraAuthConfig({ CORS_ORIGIN: '*' }).frontUrl).toBe('https://yak-planning-poker.onrender.com');
    });

    it('accepts FRONT_URL and JIRA_REDIRECT_URI overrides', () => {
        const config = loadJiraAuthConfig({
            ...complete,
            FRONT_URL: 'https://front.test/',
            JIRA_REDIRECT_URI: 'https://back.test/cb',
        });
        expect(config).toMatchObject({ frontUrl: 'https://front.test', redirectUri: 'https://back.test/cb' });
    });

    it.each(['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'SESSION_ENC_KEY'])('is disabled without %s', (name) => {
        const env: Record<string, string> = { ...complete };
        delete env[name];
        expect(loadJiraAuthConfig(env).enabled).toBe(false);
        expect(loadJiraAuthConfig({ ...env, [name]: '  ' }).enabled).toBe(false);
    });

    it('is disabled when the key does not have 32 bytes', () => {
        expect(loadJiraAuthConfig({ ...complete, SESSION_ENC_KEY: randomBytes(16).toString('base64') }).enabled).toBe(
            false,
        );
        expect(loadJiraAuthConfig({ ...complete, SESSION_ENC_KEY: 'not base64 !!' }).enabled).toBe(false);
    });

    it('ignores an invalid FRONT_URL', () => {
        expect(loadJiraAuthConfig({ ...complete, FRONT_URL: 'javascript:alert(1)' }).frontUrl).toBe(
            'https://yak-planning-poker.onrender.com',
        );
    });

    it.each(['http://front.test', 'ftp://front.test', 'http://localhost.evil.test:5173', 'not a url'])(
        'rejects the non-https FRONT_URL %s',
        (frontUrl) => {
            expect(loadJiraAuthConfig({ ...complete, FRONT_URL: frontUrl }).frontUrl).toBe(DEFAULT_FRONT);
        },
    );
    it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])('accepts %s outside production', (frontUrl) => {
        expect(loadJiraAuthConfig({ ...complete, FRONT_URL: frontUrl }).frontUrl).toBe(frontUrl);
        expect(loadJiraAuthConfig({ ...complete, FRONT_URL: frontUrl, NODE_ENV: 'development' }).frontUrl).toBe(
            frontUrl,
        );
    });
    it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])('rejects %s in production', (frontUrl) => {
        expect(loadJiraAuthConfig({ ...complete, FRONT_URL: frontUrl, NODE_ENV: 'production' }).frontUrl).toBe(
            DEFAULT_FRONT,
        );
    });
    it('does not inherit http from the first CORS origin', () => {
        expect(loadJiraAuthConfig({ CORS_ORIGIN: 'http://front.test,https://prod.app' }).frontUrl).toBe(DEFAULT_FRONT);
        expect(
            loadJiraAuthConfig({ CORS_ORIGIN: 'http://localhost:5173,https://prod.app', NODE_ENV: 'production' }).frontUrl,
        ).toBe(DEFAULT_FRONT);
    });
    it('warns without logging the rejected value', () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        loadJiraAuthConfig({ ...complete, FRONT_URL: 'http://secret-host.test' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).not.toContain('secret-host');
        warn.mockRestore();
    });
    it('does not expose values when serialized for logging', () => {
        expect(JSON.stringify(loadJiraAuthConfig(complete))).not.toContain('secret');
    });
});
