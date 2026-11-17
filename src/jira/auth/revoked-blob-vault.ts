export const REVOKED_BLOBS_LIMIT = 5000;

export class RevokedBlobVault {
    private readonly expirations = new Map<string, number>();

    constructor(
        private readonly ttlMs: number,
        private readonly limit: number = REVOKED_BLOBS_LIMIT,
    ) {}

    revoke(fingerprint: string, now: number): void {
        this.expirations.delete(fingerprint);
        this.expirations.set(fingerprint, now + this.ttlMs);
        this.discardExpired(now);
        while (this.expirations.size > this.limit) {
            this.expirations.delete(this.expirations.keys().next().value!);
        }
    }

    isRevoked(fingerprint: string, now: number): boolean {
        const expiresAt = this.expirations.get(fingerprint);
        if (expiresAt === undefined) {
            return false;
        }
        if (expiresAt <= now) {
            this.expirations.delete(fingerprint);
            return false;
        }
        return true;
    }

    private discardExpired(now: number): void {
        for (const [fingerprint, expiresAt] of this.expirations) {
            if (expiresAt > now) {
                return;
            }
            this.expirations.delete(fingerprint);
        }
    }
}
