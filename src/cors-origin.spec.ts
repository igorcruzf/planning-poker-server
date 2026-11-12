import { corsOrigin } from './cors-origin';

describe('corsOrigin', () => {
    it('allows every origin when nothing is configured', () => {
        expect(corsOrigin(undefined)).toBe('*');
        expect(corsOrigin(' , ')).toBe('*');
    });

    it('returns a single origin as string', () => {
        expect(corsOrigin('https://poker.app')).toBe('https://poker.app');
    });

    it('returns a list when several origins are configured', () => {
        expect(corsOrigin('https://a.app, https://b.app')).toEqual(['https://a.app', 'https://b.app']);
    });
});
