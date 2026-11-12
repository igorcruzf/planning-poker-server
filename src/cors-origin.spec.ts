import { corsOrigin, DEFAULT_CORS_ORIGINS } from './cors-origin';

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
