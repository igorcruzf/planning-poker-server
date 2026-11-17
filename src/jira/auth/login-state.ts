import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { JIRA_OAUTH_STATE_TTL_MS, roomCodeSchema } from '../../contracts';
import { Clock } from './jira-auth.tokens';

export const MAX_CONSUMED_STATE_NONCES = 10_000;
const STATE_KEY_INFO = 'yak-jira-state-v1';
const STATE_KEY_BYTES = 32;
const NONCE_BYTES = 16;
const BIND_BYTES = 32;
const MAX_STATE_LENGTH = 512;

const statePayloadSchema = z.strictObject({
    n: z.string().min(1).max(64),
    exp: z.number().int().nonnegative(),
    mesa: roomCodeSchema.optional(),
    b: z.string().min(1).max(64),
});

export interface IssuedLoginState {
    state: string;
    bind: string;
}

export interface VerifiedLoginState {
    nonce: string;
    expiresAt: number;
    mesa?: string;
}

export const deriveStateKey = (masterKey: Buffer): Buffer =>
    Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), STATE_KEY_INFO, STATE_KEY_BYTES));

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

const sameBytes = (first: Buffer, second: Buffer): boolean =>
    first.length === second.length && timingSafeEqual(first, second);

export class LoginStateSigner {
    private readonly key: Buffer;

    constructor(
        masterKey: Buffer,
        private readonly clock: Clock,
    ) {
        this.key = deriveStateKey(masterKey);
    }

    issue(mesa?: string): IssuedLoginState {
        const bind = randomBytes(BIND_BYTES).toString('base64url');
        const payload = {
            n: randomBytes(NONCE_BYTES).toString('base64url'),
            exp: this.clock() + JIRA_OAUTH_STATE_TTL_MS,
            ...(mesa ? { mesa } : {}),
            b: sha256(bind).toString('base64url'),
        };
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return { state: `${body}.${this.sign(body)}`, bind };
    }

    verify(state: string, bind: string | undefined): VerifiedLoginState | undefined {
        const payload = this.openPayload(state);
        if (!payload || !bind || payload.exp <= this.clock()) {
            return undefined;
        }
        if (!sameBytes(sha256(bind), Buffer.from(payload.b, 'base64url'))) {
            return undefined;
        }
        return { nonce: payload.n, expiresAt: payload.exp, mesa: payload.mesa };
    }

    private openPayload(state: string): z.infer<typeof statePayloadSchema> | undefined {
        const parts = state.length <= MAX_STATE_LENGTH ? state.split('.') : [];
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            return undefined;
        }
        const [body, signature] = parts;
        if (!sameBytes(Buffer.from(this.sign(body)), Buffer.from(signature))) {
            return undefined;
        }
        try {
            const parsed = statePayloadSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
            return parsed.success ? parsed.data : undefined;
        } catch {
            return undefined;
        }
    }

    private sign(body: string): string {
        return createHmac('sha256', this.key).update(body).digest('base64url');
    }
}

export class ConsumedNonces {
    private readonly expiries = new Map<string, number>();

    constructor(
        private readonly clock: Clock,
        private readonly maxEntries = MAX_CONSUMED_STATE_NONCES,
    ) {}

    get size(): number {
        return this.expiries.size;
    }

    consume(nonce: string, expiresAt: number): boolean {
        if (this.expiries.has(nonce)) {
            return false;
        }
        if (this.expiries.size >= this.maxEntries) {
            this.sweep();
        }
        if (this.expiries.size >= this.maxEntries) {
            return false;
        }
        this.expiries.set(nonce, expiresAt);
        return true;
    }

    sweep(): void {
        const now = this.clock();
        for (const [nonce, expiresAt] of this.expiries) {
            if (expiresAt <= now) {
                this.expiries.delete(nonce);
            }
        }
    }
}
