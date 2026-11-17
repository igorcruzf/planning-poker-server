import { createHmac, randomBytes } from 'node:crypto';
import { JIRA_OAUTH_STATE_TTL_MS } from '../../contracts';
import { ConsumedNonces, deriveStateKey, LoginStateSigner } from './login-state';

const MESA = 'yak-abcd2345';

describe('LoginStateSigner', () => {
    let now: number;
    let signer: LoginStateSigner;

    beforeEach(() => {
        now = 1_800_000_000_000;
        signer = new LoginStateSigner(randomBytes(32), () => now);
    });

    it('issues a state bound to a fresh browser secret and verifies it', () => {
        const { state, bind } = signer.issue(MESA);
        expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
        expect(bind).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const verified = signer.verify(state, bind);
        expect(verified).toMatchObject({
            mesa: MESA,
            expiresAt: now + JIRA_OAUTH_STATE_TTL_MS,
        });
        expect(verified?.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it('omits the mesa when the login did not carry one', () => {
        const { state, bind } = signer.issue();
        expect(signer.verify(state, bind)?.mesa).toBeUndefined();
    });

    it('issues different states and binds on every call', () => {
        const first = signer.issue();
        const second = signer.issue();
        expect(first.state).not.toBe(second.state);
        expect(first.bind).not.toBe(second.bind);
    });

    it('rejects a state presented with another browser secret or without one', () => {
        const { state } = signer.issue();
        expect(signer.verify(state, signer.issue().bind)).toBeUndefined();
        expect(signer.verify(state, undefined)).toBeUndefined();
        expect(signer.verify(state, '')).toBeUndefined();
    });

    it('rejects an expired state', () => {
        const { state, bind } = signer.issue();
        now += JIRA_OAUTH_STATE_TTL_MS;
        expect(signer.verify(state, bind)).toBeUndefined();
    });

    it('rejects a state signed with another key', () => {
        const { state, bind } = new LoginStateSigner(randomBytes(32), () => now).issue();
        expect(signer.verify(state, bind)).toBeUndefined();
    });

    it('rejects a tampered payload or signature', () => {
        const { state, bind } = signer.issue(MESA);
        const [payload, signature] = state.split('.');
        const forged = JSON.parse(Buffer.from(payload, 'base64url').toString());
        forged.mesa = 'yak-zzzz2345';
        const forgedPayload = Buffer.from(JSON.stringify(forged)).toString('base64url');
        expect(signer.verify(`${forgedPayload}.${signature}`, bind)).toBeUndefined();
        const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
        expect(signer.verify(`${payload}.${flipped}`, bind)).toBeUndefined();
    });

    it.each(['', 'sem-ponto', 'a.b.c', '.', 'a.', '.b'])('rejects the malformed state %p', (state) => {
        expect(signer.verify(state, 'qualquer')).toBeUndefined();
    });

    it('rejects an oversized state', () => {
        expect(signer.verify(`${'x'.repeat(2000)}.${'y'.repeat(43)}`, 'qualquer')).toBeUndefined();
    });

    it('rejects a correctly signed payload with the wrong shape', () => {
        const { bind } = signer.issue();
        const masterKey = Buffer.alloc(32, 1);
        const fake = new LoginStateSigner(masterKey, () => now);
        const sign = (payload: unknown) => {
            const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
            return `${body}.${hmacWith(masterKey, body)}`;
        };
        expect(fake.verify(sign({ n: 'x', exp: 'y' }), bind)).toBeUndefined();
    });
});

const hmacWith = (masterKey: Buffer, body: string): string =>
    createHmac('sha256', deriveStateKey(masterKey)).update(body).digest('base64url');

describe('ConsumedNonces', () => {
    let now: number;

    beforeEach(() => {
        now = 1_000;
    });

    it('accepts a nonce once and refuses its reuse', () => {
        const nonces = new ConsumedNonces(() => now, 10);
        expect(nonces.consume('a', now + 100)).toBe(true);
        expect(nonces.consume('a', now + 100)).toBe(false);
        expect(nonces.consume('b', now + 100)).toBe(true);
    });

    it('forgets a nonce after its expiry on sweep', () => {
        const nonces = new ConsumedNonces(() => now, 10);
        nonces.consume('a', now + 100);
        now += 100;
        nonces.sweep();
        expect(nonces.size).toBe(0);
    });

    it('discards the oldest nonce when full instead of refusing new ones', () => {
        const nonces = new ConsumedNonces(() => now, 2);
        expect(nonces.consume('a', now + 100)).toBe(true);
        expect(nonces.consume('b', now + 100)).toBe(true);
        expect(nonces.consume('c', now + 100)).toBe(true);
        expect(nonces.size).toBe(2);
        expect(nonces.consume('c', now + 100)).toBe(false);
        expect(nonces.consume('b', now + 100)).toBe(false);
        expect(nonces.consume('a', now + 100)).toBe(true);
    });

    it('prefers dropping expired nonces over the oldest live one when full', () => {
        const nonces = new ConsumedNonces(() => now, 2);
        nonces.consume('short', now + 10);
        nonces.consume('long', now + 1000);
        now += 10;
        expect(nonces.consume('c', now + 1000)).toBe(true);
        expect(nonces.consume('long', now + 1000)).toBe(false);
    });
});
