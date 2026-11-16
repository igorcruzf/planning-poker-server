import { KIRO_INVITE_TTL_MS, KIRO_MAX_PER_ROOM, KIRO_RATIONALE_MAX_LENGTH, SECRET_TOKEN_PATTERN } from '../contracts';
import { DomainError } from './domain-error';
import { createRoomFixture } from './testing/room-fixtures';

const errorOf = (action: () => unknown) => {
    try {
        action();
    } catch (error) {
        if (error instanceof DomainError) return error.error;
        throw error;
    }
    throw new Error('Expected a DomainError');
};

const kioskRoom = () => createRoomFixture({ settings: { allowKiro: true } });

describe('Kiro invite', () => {
    it('is refused when the room does not allow the Kiro', () => {
        const { room, owner } = createRoomFixture();
        expect(errorOf(() => room.createKiroInvite(owner.id))).toEqual({ code: 'kiro_disabled' });
    });

    it('is refused for spectators? no: any human of the room may invite, outsiders may not', () => {
        const { room } = kioskRoom();
        expect(errorOf(() => room.createKiroInvite('ghost'))).toEqual({ code: 'forbidden', reason: 'not_in_room' });
    });

    it('creates a single-use 43-character code that expires in 10 minutes', () => {
        const { room, clock, owner } = kioskRoom();
        const invite = room.createKiroInvite(owner.id);
        expect(invite.inviteCode).toMatch(SECRET_TOKEN_PATTERN);
        expect(invite.expiresAt).toBe(clock.now() + KIRO_INVITE_TTL_MS);
        room.redeemKiroInvite(invite.inviteCode);
        expect(errorOf(() => room.redeemKiroInvite(invite.inviteCode))).toEqual({ code: 'invite_invalid' });
    });

    it('rejects an expired invite and an unknown code', () => {
        const { room, clock, owner } = kioskRoom();
        const invite = room.createKiroInvite(owner.id);
        clock.advance(KIRO_INVITE_TTL_MS);
        expect(errorOf(() => room.redeemKiroInvite(invite.inviteCode))).toEqual({ code: 'invite_invalid' });
        expect(errorOf(() => room.redeemKiroInvite('x'.repeat(43)))).toEqual({ code: 'invite_invalid' });
    });

    it('only recognises codes of its own room', () => {
        const { room, owner } = kioskRoom();
        const invite = room.createKiroInvite(owner.id);
        expect(room.hasKiroInvite(invite.inviteCode)).toBe(true);
        expect(room.hasKiroInvite('y'.repeat(43))).toBe(false);
    });

    it('keeps only the latest invite of each owner', () => {
        const { room, owner } = kioskRoom();
        const first = room.createKiroInvite(owner.id);
        const second = room.createKiroInvite(owner.id);
        expect(errorOf(() => room.redeemKiroInvite(first.inviteCode))).toEqual({ code: 'invite_invalid' });
        expect(room.redeemKiroInvite(second.inviteCode).participantId).toBeDefined();
    });
});

describe('Kiro seats', () => {
    it('seats a bot named after the owner and linked to them', () => {
        const { room, owner } = kioskRoom();
        const seat = room.redeemKiroInvite(room.createKiroInvite(owner.id).inviteCode);
        expect(seat.seatName).toBe('Kiro do Ana');
        expect(room.requireParticipant(seat.participantId)).toMatchObject({
            role: 'bot',
            ownerId: owner.id,
            presence: 'connected',
            tokenHash: null,
        });
    });

    it('allows one Kiro per owner', () => {
        const { room, owner } = kioskRoom();
        room.redeemKiroInvite(room.createKiroInvite(owner.id).inviteCode);
        expect(errorOf(() => room.createKiroInvite(owner.id))).toEqual({ code: 'kiro_limit_per_owner', limit: 1 });
    });

    it('rechecks the limit when the invite is redeemed', () => {
        const { room, owner } = kioskRoom();
        const invite = room.createKiroInvite(owner.id);
        room.redeemKiroInvite(invite.inviteCode);
        const lateInvite = { ...invite };
        expect(errorOf(() => room.redeemKiroInvite(lateInvite.inviteCode))).toEqual({ code: 'invite_invalid' });
    });

    it('allows at most 3 Kiros per room', () => {
        const { room, owner, join } = kioskRoom();
        const owners = [owner, join('Bia'), join('Leo', 'spectator')];
        owners.forEach((person) => room.redeemKiroInvite(room.createKiroInvite(person.id).inviteCode));
        expect(KIRO_MAX_PER_ROOM).toBe(3);
        const dan = join('Dan');
        expect(errorOf(() => room.createKiroInvite(dan.id))).toEqual({ code: 'kiro_limit_per_room', limit: 3 });
    });

    it('removes the Kiro when its owner leaves, and frees the owner slot when the Kiro leaves', () => {
        const { room, owner, join } = kioskRoom();
        const bia = join('Bia');
        const biaKiro = room.redeemKiroInvite(room.createKiroInvite(bia.id).inviteCode);
        const anaKiro = room.redeemKiroInvite(room.createKiroInvite(owner.id).inviteCode);
        room.leave(bia.id);
        expect(room.participants.some((participant) => participant.id === biaKiro.participantId)).toBe(false);
        room.leave(anaKiro.participantId);
        expect(() => room.createKiroInvite(owner.id)).not.toThrow();
    });
});

describe('Kiro vote', () => {
    const seated = () => {
        const fixture = kioskRoom();
        const seat = fixture.room.redeemKiroInvite(fixture.room.createKiroInvite(fixture.owner.id).inviteCode);
        return { ...fixture, kiroId: seat.participantId };
    };

    it('stores the vote with its rationale and lets the Kiro change it', () => {
        const { room, kiroId } = seated();
        room.castKiroVote(kiroId, { value: 'P', rationale: 'Pouca mudança' });
        room.castKiroVote(kiroId, { value: 'M', rationale: 'Tem migração' });
        expect(room.requireParticipant(kiroId)).toMatchObject({ vote: 'M', rationale: 'Tem migração' });
    });

    it('accepts a rationale of exactly 280 characters and rejects 281 or an empty one', () => {
        const { room, kiroId } = seated();
        room.castKiroVote(kiroId, { value: 'P', rationale: 'a'.repeat(KIRO_RATIONALE_MAX_LENGTH) });
        expect(errorOf(() => room.castKiroVote(kiroId, { value: 'P', rationale: 'a'.repeat(281) }))).toMatchObject({
            code: 'invalid_payload',
        });
        expect(errorOf(() => room.castKiroVote(kiroId, { value: 'P', rationale: '  ' }))).toMatchObject({
            code: 'invalid_payload',
        });
    });

    it('rejects a value outside the deck, a human caller and a non-voting phase', () => {
        const { room, owner, kiroId } = seated();
        expect(errorOf(() => room.castKiroVote(kiroId, { value: 'XL', rationale: 'x' }))).toEqual({
            code: 'invalid_vote',
        });
        expect(errorOf(() => room.castKiroVote(owner.id, { value: 'P', rationale: 'x' }))).toEqual({
            code: 'forbidden',
            reason: 'not_in_room',
        });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: true });
        expect(errorOf(() => room.castKiroVote(kiroId, { value: 'P', rationale: 'x' }))).toEqual({
            code: 'wrong_phase',
            phase: 'countdown',
        });
    });
});
