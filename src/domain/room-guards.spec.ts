import { KIRO_SEAT_NAME_PREFIX } from '../contracts';
import { DomainError } from './domain-error';
import { HISTORY_MAX_ENTRIES } from './room';
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

const nameTaken = { code: 'invalid_payload', issues: [{ path: 'name', message: 'name_taken' }] };

describe('Reserved Kiro seat names', () => {
    it.each(['Kiro do Ana', 'kiro do ana', '  KIRO DO Bia', 'Kiro do '])('refuses the human name %p', (name) => {
        const { room } = createRoomFixture({ settings: { allowKiro: true } });
        expect(errorOf(() => room.join({ name, role: 'player' }))).toEqual(nameTaken);
    });

    it('lets the owner redeem the invite after someone tried to take the Kiro name', () => {
        const { room, owner } = createRoomFixture({ settings: { allowKiro: true } });
        const invite = room.createKiroInvite(owner.id);
        expect(errorOf(() => room.join({ name: `${KIRO_SEAT_NAME_PREFIX}Ana`, role: 'player' }))).toEqual(nameTaken);
        expect(room.redeemKiroInvite(invite.inviteCode).seatName).toBe('Kiro do Ana');
    });

    it('still accepts names that only look similar', () => {
        const { room } = createRoomFixture();
        expect(() => room.join({ name: 'Kiro', role: 'player' })).not.toThrow();
        expect(() => room.join({ name: 'Kirodo Leo', role: 'player' })).not.toThrow();
        expect(() => room.join({ name: 'Kiro Domingos', role: 'player' })).not.toThrow();
    });

    it('refuses a creator name with the reserved prefix', () => {
        expect(errorOf(() => createRoomFixture({ participantName: 'Kiro do Ana' }))).toEqual(nameTaken);
    });
});

describe('Name comparison', () => {
    it('ignores case without depending on the locale', () => {
        const { room, owner } = createRoomFixture({ participantName: 'IVO' });
        expect(errorOf(() => room.join({ name: 'ivo', role: 'player' }))).toEqual(nameTaken);
        expect(room.requireParticipant(owner.id).name).toBe('IVO');
    });

    it('treats composed and decomposed accents as the same name', () => {
        const { room } = createRoomFixture({ participantName: 'Jo\u00e3o' });
        expect(errorOf(() => room.join({ name: 'Joa\u0303o', role: 'player' }))).toEqual(nameTaken);
    });
});

describe('Role and deck changes after the reveal', () => {
    const revealedRoom = () => {
        const fixture = createRoomFixture({ settings: { countdownSeconds: 0 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.vote(bia.id, { roundId: 1, value: '?' });
        fixture.room.reveal(fixture.owner.id, { roundId: 1, confirmMissingVotes: false });
        return { ...fixture, bia };
    };

    it('refuses a role change with wrong_phase and keeps the votes', () => {
        const { room, bia } = revealedRoom();
        expect(errorOf(() => room.setRole(bia.id, 'spectator'))).toEqual({ code: 'wrong_phase', phase: 'revealed' });
        expect(room.requireParticipant(bia.id)).toMatchObject({ role: 'player', vote: '?' });
    });

    it('refuses a role change during the countdown', () => {
        const { room, owner, join } = createRoomFixture({ settings: { countdownSeconds: 3 } });
        const bia = join('Bia');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.vote(bia.id, { roundId: 1, value: 'G' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        expect(errorOf(() => room.setRole(bia.id, 'spectator'))).toEqual({ code: 'wrong_phase', phase: 'countdown' });
        expect(room.requireParticipant(bia.id).vote).toBe('G');
    });

    it('refuses a deck or special cards change and keeps the votes equal to the history', () => {
        const { room, owner, bia } = revealedRoom();
        expect(errorOf(() => room.updateSettings(owner.id, { specialCards: [] }))).toEqual({
            code: 'wrong_phase',
            phase: 'revealed',
        });
        const custom = { presetId: 'custom' as const, cards: [{ value: 'PP' }, { value: 'P' }] };
        expect(errorOf(() => room.updateSettings(owner.id, { deck: custom }))).toEqual({
            code: 'wrong_phase',
            phase: 'revealed',
        });
        expect(room.requireParticipant(bia.id).vote).toBe('?');
        expect(room.history[0].votes).toEqual([
            { name: 'Ana', value: 'P' },
            { name: 'Bia', value: '?' },
        ]);
    });

    it('still allows the other settings and an unchanged deck after the reveal', () => {
        const { room, owner } = revealedRoom();
        room.updateSettings(owner.id, { autoReveal: true, countdownSeconds: 5, deck: room.settings.deck });
        expect(room.settings).toMatchObject({ autoReveal: true, countdownSeconds: 5 });
    });

    it('still clears the vote of a player who becomes a spectator during voting', () => {
        const { room, owner } = createRoomFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.setRole(owner.id, 'spectator');
        expect(room.requireParticipant(owner.id).vote).toBeNull();
    });
});

describe('History limit', () => {
    it('keeps only the latest rounds and drops the oldest', () => {
        const { room, owner } = createRoomFixture({ settings: { countdownSeconds: 0 } });
        for (let round = 1; round <= HISTORY_MAX_ENTRIES + 2; round++) {
            room.vote(owner.id, { roundId: round, value: 'P' });
            room.reveal(owner.id, { roundId: round, confirmMissingVotes: false });
            room.reset(owner.id, { roundId: round });
        }
        expect(room.history).toHaveLength(HISTORY_MAX_ENTRIES);
        expect(room.history[0].roundId).toBe(3);
        expect(room.history[HISTORY_MAX_ENTRIES - 1].roundId).toBe(HISTORY_MAX_ENTRIES + 2);
    });
});

describe('Kiro vote result', () => {
    it('returns the round id together with the phase', () => {
        const { room, owner } = createRoomFixture({ settings: { allowKiro: true } });
        const kiro = room.redeemKiroInvite(room.createKiroInvite(owner.id).inviteCode);
        expect(room.castKiroVote(kiro.participantId, { value: 'P', rationale: 'Parece pequeno' })).toEqual({
            phase: 'voting',
            roundId: 1,
        });
    });
});

describe('Read-only views', () => {
    it('hands out a copy of the settings', () => {
        const { room, owner } = createRoomFixture();
        const settings = room.settings;
        settings.autoReveal = true;
        settings.deck.cards.length = 0;
        expect(room.settings.autoReveal).toBe(false);
        expect(room.settings.deck.cards.length).toBeGreaterThan(0);
        expect(owner.id).toBeDefined();
    });

    it('does not expose the token hash through the participants', () => {
        const { room, owner } = createRoomFixture();
        expect(room.participants[0]).not.toHaveProperty('tokenHash');
        expect(room.requireParticipant(owner.id)).not.toHaveProperty('tokenHash');
        expect(room.findParticipant(owner.id)).not.toHaveProperty('tokenHash');
    });
});
