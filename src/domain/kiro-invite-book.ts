import { KIRO_INVITE_TTL_MS } from '../contracts';
import { generateSecret, hashSecret } from './secrets';

interface PendingInvite {
    readonly ownerId: string;
    readonly expiresAt: number;
}

export class KiroInviteBook {
    private readonly invites = new Map<string, PendingInvite>();

    issue(ownerId: string, now: number): { inviteCode: string; expiresAt: number } {
        this.discardExpired(now);
        this.discardOwner(ownerId);
        const inviteCode = generateSecret();
        const expiresAt = now + KIRO_INVITE_TTL_MS;
        this.invites.set(hashSecret(inviteCode), { ownerId, expiresAt });
        return { inviteCode, expiresAt };
    }

    ownerOf(inviteCode: string, now: number): string | null {
        const invite = this.invites.get(hashSecret(inviteCode));
        return invite && invite.expiresAt > now ? invite.ownerId : null;
    }

    consume(inviteCode: string): void {
        this.invites.delete(hashSecret(inviteCode));
    }

    discardOwner(ownerId: string): void {
        for (const [hash, invite] of this.invites) {
            if (invite.ownerId === ownerId) this.invites.delete(hash);
        }
    }

    private discardExpired(now: number): void {
        for (const [hash, invite] of this.invites) {
            if (invite.expiresAt <= now) this.invites.delete(hash);
        }
    }
}
