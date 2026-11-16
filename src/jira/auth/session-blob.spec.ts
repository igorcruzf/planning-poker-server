import { randomBytes } from 'node:crypto';
import { JIRA_SESSION_BLOB_MAX_LENGTH, jiraSessionBlobSchema } from '../../contracts';
import { JiraAppException } from './jira-app.exception';
import { SessionBlobCodec, SessionPayload } from './session-blob';

const payload: SessionPayload = {
    v: 1,
    refreshToken: 'refresh-secret-value',
    cloudId: 'cloud-1',
    accountId: 'account-1',
    issuedAt: 1_700_000_000_000,
};

const reconnectRequired = (action: () => unknown) => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(JiraAppException);
        expect((error as JiraAppException).code).toBe('jira_reconnect_required');
        return;
    }
    throw new Error('expected jira_reconnect_required');
};

describe('SessionBlobCodec', () => {
    const codec = new SessionBlobCodec(randomBytes(32));

    it('round trips the payload', () => {
        expect(codec.decode(codec.encode(payload))).toEqual(payload);
    });

    it('produces a blob accepted by the contract schema without readable secrets', () => {
        const blob = codec.encode(payload);
        expect(jiraSessionBlobSchema.safeParse(blob).success).toBe(true);
        expect(blob).not.toContain(payload.refreshToken);
        expect(Buffer.from(blob, 'base64url').toString('latin1')).not.toContain(payload.refreshToken);
    });

    it('uses a different random IV for two blobs of the same payload', () => {
        const first = codec.encode(payload);
        const second = codec.encode(payload);
        expect(first).not.toBe(second);
        expect(Buffer.from(first, 'base64url').subarray(0, 12)).not.toEqual(
            Buffer.from(second, 'base64url').subarray(0, 12),
        );
    });

    it('rejects a blob tampered in any single byte', () => {
        const bytes = Buffer.from(codec.encode(payload), 'base64url');
        for (let index = 0; index < bytes.length; index += 1) {
            const tampered = Buffer.from(bytes);
            tampered[index] ^= 0x01;
            reconnectRequired(() => codec.decode(tampered.toString('base64url')));
        }
    });

    it('rejects a blob made with another key', () => {
        const other = new SessionBlobCodec(randomBytes(32));
        reconnectRequired(() => codec.decode(other.encode(payload)));
    });

    it('rejects an unknown version', () => {
        reconnectRequired(() => codec.decode(codec.encode({ ...payload, v: 2 } as unknown as SessionPayload)));
    });

    it('rejects a payload with the wrong shape', () => {
        reconnectRequired(() => codec.decode(codec.encode({ ...payload, cloudId: 7 } as unknown as SessionPayload)));
    });

    it.each([
        ['invalid base64url', '***not-base64***'],
        ['empty text', ''],
        ['too short', 'AAAA'],
        ['absurdly large', 'A'.repeat(JIRA_SESSION_BLOB_MAX_LENGTH + 1)],
    ])('rejects %s', (_, blob) => {
        reconnectRequired(() => codec.decode(blob));
    });

    it('requires a 32 byte key', () => {
        expect(() => new SessionBlobCodec(randomBytes(16))).toThrow();
    });

    it('hashes a blob to a stable fingerprint that does not contain it', () => {
        const blob = codec.encode(payload);
        expect(SessionBlobCodec.fingerprint(blob)).toBe(SessionBlobCodec.fingerprint(blob));
        expect(SessionBlobCodec.fingerprint(blob)).not.toContain(blob.slice(0, 10));
    });
});
