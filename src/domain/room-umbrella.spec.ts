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

describe('Umbrella', () => {
    it('is down by default and follows the participant choice', () => {
        const { room, owner } = createRoomFixture();

        expect(room.requireParticipant(owner.id).umbrella).toBe(false);
        expect(room.setUmbrella(owner.id, true)).toBe(true);
        expect(room.requireParticipant(owner.id).umbrella).toBe(true);
        expect(room.setUmbrella(owner.id, false)).toBe(true);
        expect(room.requireParticipant(owner.id).umbrella).toBe(false);
    });

    it('reports no change when the state is already the requested one', () => {
        const { room, owner } = createRoomFixture();

        expect(room.setUmbrella(owner.id, false)).toBe(false);
    });

    it('lets a spectator hold an umbrella', () => {
        const { room, join } = createRoomFixture();
        const spectator = join('Duda', 'spectator');

        expect(room.setUmbrella(spectator.id, true)).toBe(true);
    });

    it('refuses a participant without a seat', () => {
        const { room } = createRoomFixture();

        expect(errorOf(() => room.setUmbrella('p-ghost', true))).toEqual({ code: 'forbidden', reason: 'not_in_room' });
    });

    it('refuses a Kiro seat', () => {
        const { room, owner } = createRoomFixture({ settings: { allowKiro: true } });
        const { inviteCode } = room.createKiroInvite(owner.id);
        const kiro = room.redeemKiroInvite(inviteCode);

        expect(errorOf(() => room.setUmbrella(kiro.participantId, true))).toEqual({
            code: 'forbidden',
            reason: 'not_in_room',
        });
    });
});

describe('Session token authentication', () => {
    it('returns the view of the participant that owns the token', () => {
        const { room, owner } = createRoomFixture();

        const view = room.authenticate(owner.token);

        expect(view.id).toBe(owner.id);
        expect(view).not.toHaveProperty('tokenHash');
        expect(room.facilitatorId).toBe(view.id);
    });

    it('refuses an unknown token with session_token_invalid', () => {
        const { room } = createRoomFixture();

        expect(errorOf(() => room.authenticate('not-a-token'))).toEqual({ code: 'session_token_invalid' });
    });

    it('does not mark the participant as connected', () => {
        const { room, owner } = createRoomFixture();
        room.markDisconnected(owner.id);

        room.authenticate(owner.token);

        expect(room.requireParticipant(owner.id).presence).toBe('disconnected');
    });
});
