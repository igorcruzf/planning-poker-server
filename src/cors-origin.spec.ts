import { corsOptions, corsOrigin, DEFAULT_CORS_ORIGINS } from './cors-origin';

const PRODUCTION_FRONT = 'https://yak-planning-poker.onrender.com';

describe('corsOrigin', () => {
    it('defaults to the published front origin when nothing is configured', () => {
        expect(corsOrigin(undefined)).toBe(PRODUCTION_FRONT);
        expect(corsOrigin(' , ')).toBe(PRODUCTION_FRONT);
    });

    it('returns a single origin as string', () => {
        expect(corsOrigin('https://poker.app')).toBe('https://poker.app');
    });

    it('returns a list when several origins are configured', () => {
        expect(corsOrigin('https://a.app, https://b.app')).toEqual(['https://a.app', 'https://b.app']);
    });

    it('allows every origin when the wildcard is configured explicitly', () => {
        expect(corsOrigin('*')).toBe('*');
    });

    it('exposes the default origin list', () => {
        expect(DEFAULT_CORS_ORIGINS).toEqual([PRODUCTION_FRONT]);
    });
});

describe('corsOptions', () => {
    it('keeps the configured origins', () => {
        expect(corsOptions('https://a.app, https://b.app').origin).toEqual(['https://a.app', 'https://b.app']);
        expect(corsOptions(undefined).origin).toBe(PRODUCTION_FRONT);
    });
    it('allows the headers sent by the front', () => {
        expect(corsOptions().allowedHeaders).toEqual(['Authorization', 'Content-Type', 'X-Yak-Room-Session']);
    });
    it('exposes the refreshed Jira session header', () => {
        expect(corsOptions().exposedHeaders).toEqual(['X-Yak-Jira-Session']);
    });
});
