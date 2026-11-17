import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { JIRA_SESSION_BLOB_MAX_LENGTH, httpUrlSchema, jiraSessionBlobSchema } from '../../contracts';
import { jiraError } from './jira-app.exception';

export const SESSION_BLOB_VERSION = 1;
export const SESSION_KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const sessionPayloadSchema = z.strictObject({
    v: z.literal(SESSION_BLOB_VERSION),
    refreshToken: z.string().min(1),
    cloudId: z.string().min(1),
    accountId: z.string().min(1),
    siteUrl: httpUrlSchema,
    issuedAt: z.number().int().nonnegative(),
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export class SessionBlobCodec {
    constructor(private readonly key: Buffer) {
        if (key.length !== SESSION_KEY_BYTES) {
            throw new Error(`Session key must have ${SESSION_KEY_BYTES} bytes`);
        }
    }

    static fingerprint(blob: string): string {
        return createHash('sha256').update(blob).digest('base64url');
    }

    encode(payload: SessionPayload): string {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv(ALGORITHM, this.key, iv, {
            authTagLength: TAG_BYTES,
        });
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
        const blob = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
        if (blob.length > JIRA_SESSION_BLOB_MAX_LENGTH) {
            throw new Error('Session blob exceeds the contract limit');
        }
        return blob;
    }

    decode(blob: string): SessionPayload {
        try {
            return this.open(blob);
        } catch {
            throw jiraError('jira_reconnect_required');
        }
    }

    private open(blob: string): SessionPayload {
        if (!jiraSessionBlobSchema.safeParse(blob).success) {
            throw new Error('malformed');
        }
        const bytes = Buffer.from(blob, 'base64url');
        if (bytes.length <= IV_BYTES + TAG_BYTES) {
            throw new Error('malformed');
        }
        const iv = bytes.subarray(0, IV_BYTES);
        const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
            authTagLength: TAG_BYTES,
        });
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        return sessionPayloadSchema.parse(JSON.parse(plain.toString('utf8')));
    }
}
