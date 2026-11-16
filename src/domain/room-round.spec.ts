import { DISCONNECTED_PLAYER_GRACE_MS } from '../contracts';
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

const withKiro = () => {
    const fixture = createRoomFixture({ settings: { allowKiro: true } });
    const invite = fixture.room.createKiroInvite(fixture.owner.id);
    const kiro = fixture.room.redeemKiroInvite(invite.inviteCode);
    return { ...fixture, kiroId: kiro.participantId };
};

describe('Round voting', () => {
    it('stores one vote per player and lets the player change it until the reveal', () => {
        const { room, owner } = createRoomFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.vote(owner.id, { roundId: 1, value: 'G' });
        expect(room.requireParticipant(owner.id).vote).toBe('G');
        room.vote(owner.id, { roundId: 1, value: null });
        expect(room.requireParticipant(owner.id).vote).toBeNull();
    });

    it.each(['XL', '', 'yakult-x', 'P '])('rejects the value %p that is not in the deck', (value) => {
        const { room, owner } = createRoomFixture();
        expect(errorOf(() => room.vote(owner.id, { roundId: 1, value }))).toEqual({ code: 'invalid_vote' });
    });

    it('accepts ? and yakult only while the room has them enabled', () => {
        const { room, owner } = createRoomFixture();
        room.vote(owner.id, { roundId: 1, value: '?' });
        room.vote(owner.id, { roundId: 1, value: 'yakult' });
        room.updateSettings(owner.id, { specialCards: ['?'] });
        expect(room.requireParticipant(owner.id).vote).toBeNull();
        expect(errorOf(() => room.vote(owner.id, { roundId: 1, value: 'yakult' }))).toEqual({ code: 'invalid_vote' });
    });

    it('rejects a stale round, a spectator, an outsider and a non-voting phase', () => {
        const { room, owner, join } = createRoomFixture();
        const leo = join('Leo', 'spectator');
        expect(errorOf(() => room.vote(owner.id, { roundId: 2, value: 'P' }))).toEqual({ code: 'round_stale' });
        expect(errorOf(() => room.vote(leo.id, { roundId: 1, value: 'P' }))).toEqual({
            code: 'forbidden',
            reason: 'players_only',
        });
        expect(errorOf(() => room.vote('ghost', { roundId: 1, value: 'P' }))).toEqual({
            code: 'forbidden',
            reason: 'not_in_room',
        });
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        room.finishCountdown(1);
        expect(errorOf(() => room.vote(owner.id, { roundId: 1, value: 'G' }))).toEqual({
            code: 'wrong_phase',
            phase: 'revealed',
        });
    });

    it('does not let the Kiro seat vote as a player', () => {
        const { room, kiroId } = withKiro();
        expect(errorOf(() => room.vote(kiroId, { roundId: 1, value: 'P' }))).toEqual({
            code: 'forbidden',
            reason: 'players_only',
        });
    });
});

describe('Reveal rules (D8)', () => {
    it('lets any player reveal when everyone voted', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.vote(bia.id, { roundId: 1, value: 'M' });
        expect(room.reveal(bia.id, { roundId: 1, confirmMissingVotes: false })).toEqual({ phase: 'countdown' });
    });

    it('blocks a non-facilitator player when votes are missing', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        expect(errorOf(() => room.reveal(bia.id, { roundId: 1, confirmMissingVotes: true }))).toEqual({
            code: 'forbidden',
            reason: 'facilitator_only',
        });
        expect(room.phase).toBe('voting');
    });

    it('asks the facilitator for confirmation naming who is missing', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        expect(errorOf(() => room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false }))).toEqual({
            code: 'votes_pending',
            missing: [
                { participantId: owner.id, name: 'Ana' },
                { participantId: bia.id, name: 'Bia' },
            ],
        });
    });

    it('lets the facilitator reveal with votes missing once confirmed', () => {
        const { room, owner, join } = createRoomFixture();
        join('Bia');
        expect(room.reveal(owner.id, { roundId: 1, confirmMissingVotes: true })).toEqual({ phase: 'countdown' });
    });

    it('never lets spectators or the Kiro reveal or reset', () => {
        const { room, owner, join, kiroId } = withKiro();
        const leo = join('Leo', 'spectator');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        for (const actorId of [leo.id, kiroId]) {
            const forbidden = { code: 'forbidden', reason: 'players_only' };
            expect(errorOf(() => room.reveal(actorId, { roundId: 1, confirmMissingVotes: true }))).toEqual(forbidden);
            expect(errorOf(() => room.reset(actorId, { roundId: 1 }))).toEqual(forbidden);
        }
        expect(room.phase).toBe('voting');
    });

    it('does not let a facilitator who became a spectator reveal or reset, but keeps the settings power', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.vote(bia.id, { roundId: 1, value: 'P' });
        room.setRole(owner.id, 'spectator');
        const forbidden = { code: 'forbidden', reason: 'players_only' };
        expect(errorOf(() => room.reveal(owner.id, { roundId: 1, confirmMissingVotes: true }))).toEqual(forbidden);
        expect(errorOf(() => room.reset(owner.id, { roundId: 1 }))).toEqual(forbidden);
        room.updateSettings(owner.id, { autoReveal: true });
        expect(room.settings.autoReveal).toBe(true);
    });

    it('ignores spectators and the Kiro when checking who is pending', () => {
        const { room, owner, join, kiroId } = withKiro();
        join('Leo', 'spectator');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        expect(room.pendingVoterIds()).toEqual([]);
        expect(room.requireParticipant(kiroId).vote).toBeNull();
    });

    it('still waits for a player disconnected for 29 seconds', () => {
        const { room, clock, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.markDisconnected(bia.id);
        clock.advance(DISCONNECTED_PLAYER_GRACE_MS - 1000);
        expect(room.pendingVoterIds()).toEqual([bia.id]);
        expect(errorOf(() => room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false }))).toMatchObject({
            code: 'votes_pending',
        });
    });

    it('stops waiting for a player disconnected for 31 seconds', () => {
        const { room, clock, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.markDisconnected(bia.id);
        clock.advance(DISCONNECTED_PLAYER_GRACE_MS + 1000);
        expect(room.pendingVoterIds()).toEqual([]);
        expect(room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false })).toEqual({ phase: 'countdown' });
    });

    it('is idempotent for the same round and rejects another round id', () => {
        const { room, owner } = createRoomFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        expect(room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false })).toEqual({ phase: 'countdown' });
        room.finishCountdown(1);
        expect(room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false })).toEqual({ phase: 'revealed' });
        expect(room.history).toHaveLength(1);
        expect(errorOf(() => room.reveal(owner.id, { roundId: 2, confirmMissingVotes: false }))).toEqual({
            code: 'round_stale',
        });
    });

    it('reveals at once when the countdown is 0 seconds', () => {
        const { room, owner } = createRoomFixture({ settings: { countdownSeconds: 0 } });
        room.vote(owner.id, { roundId: 1, value: 'P' });
        expect(room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false })).toEqual({ phase: 'revealed' });
    });

    it('reveals automatically after the last pending vote when autoReveal is on', () => {
        const { room, owner, join } = createRoomFixture({ settings: { autoReveal: true } });
        const bia = join('Bia');
        expect(room.vote(owner.id, { roundId: 1, value: 'P' })).toEqual({ phase: 'voting' });
        expect(room.vote(bia.id, { roundId: 1, value: 'G' })).toEqual({ phase: 'countdown' });
    });

    it('does not auto reveal when only the Kiro voted', () => {
        const { room, kiroId } = withKiro();
        room.updateSettings(room.facilitatorId!, { autoReveal: true });
        expect(room.castKiroVote(kiroId, { value: 'P', rationale: 'Parece pequeno' })).toEqual({
            phase: 'voting',
            roundId: 1,
        });
    });
});

describe('Countdown', () => {
    it('exposes the reveal time and locks votes until it finishes', () => {
        const { room, clock, owner } = createRoomFixture({ settings: { countdownSeconds: 5 } });
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        expect(room.countdown).toEqual({ revealAt: clock.now() + 5000, countdownMs: 5000 });
        expect(errorOf(() => room.vote(owner.id, { roundId: 1, value: 'G' }))).toEqual({
            code: 'wrong_phase',
            phase: 'countdown',
        });
        expect(room.finishCountdown(1)).toEqual({ phase: 'revealed' });
        expect(room.revealedAt).toBe(clock.now());
    });

    it('ignores a finish for a round that was reset or already finished', () => {
        const { room, owner } = createRoomFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        room.reset(owner.id, { roundId: 1 });
        expect(room.finishCountdown(1)).toEqual({ phase: 'voting' });
        expect(room.history).toHaveLength(0);
    });
});

describe('Reset (new hand)', () => {
    it('opens a new round, clearing votes and the Kiro rationale', () => {
        const { room, owner, kiroId } = withKiro();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.castKiroVote(kiroId, { value: 'G', rationale: 'Muito trabalho' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        room.finishCountdown(1);
        room.reset(owner.id, { roundId: 1 });
        expect(room.roundId).toBe(2);
        expect(room.phase).toBe('voting');
        expect(room.requireParticipant(owner.id).vote).toBeNull();
        expect(room.requireParticipant(kiroId)).toMatchObject({ vote: null, rationale: null });
        expect(room.history).toHaveLength(1);
    });

    it('reports round_stale when someone else already opened the new hand', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.reset(owner.id, { roundId: 1 });
        expect(errorOf(() => room.reset(bia.id, { roundId: 1 }))).toEqual({ code: 'round_stale' });
    });

    it('lets any player reset, even a non-facilitator', () => {
        const { room, join } = createRoomFixture();
        const bia = join('Bia');
        room.reset(bia.id, { roundId: 1 });
        expect(room.roundId).toBe(2);
    });
});

describe('Final estimate and history', () => {
    const revealedRoom = () => {
        const fixture = createRoomFixture();
        const bia = fixture.join('Bia');
        fixture.room.setCurrentIssue(fixture.owner.id, { key: 'YAK-9', summary: 'Pagamento' });
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.vote(bia.id, { roundId: 1, value: '?' });
        fixture.room.reveal(fixture.owner.id, { roundId: 1, confirmMissingVotes: false });
        fixture.room.finishCountdown(1);
        return { ...fixture, bia };
    };

    it('records the revealed round with names, issue and Kiro setting', () => {
        const { room, clock } = revealedRoom();
        expect(room.history).toEqual([
            {
                roundId: 1,
                issue: { key: 'YAK-9', summary: 'Pagamento' },
                finalEstimate: null,
                votes: [
                    { name: 'Ana', value: 'P' },
                    { name: 'Bia', value: '?' },
                ],
                kiroGuesses: [],
                kiroCountedAsPlayer: false,
                revealedAt: clock.now(),
            },
        ]);
    });

    it('lets only the facilitator finalize with a deck card, once revealed', () => {
        const { room, owner, bia } = revealedRoom();
        expect(errorOf(() => room.finalize(bia.id, { roundId: 1, value: 'P' }))).toEqual({
            code: 'forbidden',
            reason: 'facilitator_only',
        });
        expect(errorOf(() => room.finalize(owner.id, { roundId: 1, value: '?' }))).toEqual({ code: 'invalid_vote' });
        expect(errorOf(() => room.finalize(owner.id, { roundId: 1, value: 'XL' }))).toEqual({ code: 'invalid_vote' });
        expect(errorOf(() => room.finalize(owner.id, { roundId: 2, value: 'P' }))).toEqual({ code: 'round_stale' });
        room.finalize(owner.id, { roundId: 1, value: 'P' });
        expect(room.finalEstimate).toEqual({ value: 'P', meaning: 'até 5 dias' });
        expect(room.history[0].finalEstimate).toEqual({ value: 'P', meaning: 'até 5 dias' });
    });

    it('refuses to finalize before the reveal', () => {
        const { room, owner } = createRoomFixture();
        expect(errorOf(() => room.finalize(owner.id, { roundId: 1, value: 'P' }))).toEqual({
            code: 'wrong_phase',
            phase: 'voting',
        });
    });
});
