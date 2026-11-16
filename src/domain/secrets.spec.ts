import { SECRET_TOKEN_PATTERN } from '../contracts';
import { generateSecret, hashSecret, secretMatchesHash } from './secrets';

describe('secrets', () => {
    it('generates 43-character base64url secrets that differ every time', () => {
        const first = generateSecret();
        expect(first).toMatch(SECRET_TOKEN_PATTERN);
        expect(generateSecret()).not.toBe(first);
    });

    it('matches a secret only against its own hash', () => {
        const secret = generateSecret();
        const hash = hashSecret(secret);
        expect(hash).not.toContain(secret);
        expect(secretMatchesHash(secret, hash)).toBe(true);
        expect(secretMatchesHash(generateSecret(), hash)).toBe(false);
        expect(secretMatchesHash('', hash)).toBe(false);
    });
});
