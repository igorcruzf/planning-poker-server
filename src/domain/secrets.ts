import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SECRET_TOKEN_BYTES } from '../contracts';

export const generateSecret = (): string => randomBytes(SECRET_TOKEN_BYTES).toString('base64url');

export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export const secretMatchesHash = (secret: string, expectedHash: string): boolean => {
    const actual = Buffer.from(hashSecret(secret));
    const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
};
