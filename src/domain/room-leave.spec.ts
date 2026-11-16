import { roomStateSchema } from '../contracts';
import { snapshotFor } from './snapshot';
import { createRoomFixture } from './testing/room-fixtures';

const votedRoom = (countdownSeconds: number) => {
    const fixture = createRoomFixture({ settings: { allowKiro: true, countdownSeconds } });
    const bia = fixture.join('Bia');
    const invite = fixture.room.createKiroInvite(bia.id);
    const kiro = fixture.room.redeemKiroInvite(invite.inviteCode);
    fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
    fixture.room.vote(bia.id, { roundId: 1, value: 'M' });
    fixture.room.castKiroVote(kiro.participantId, { value: 'G', rationale: 'Parece grande' });
    return { ...fixture, bia, kiro };
};

const revealedVotes = (fixture: ReturnType<typeof votedRoom>) => {
    const state = snapshotFor(fixture.room, fixture.owner.id);
    expect(roomStateSchema.safeParse(state).success).toBe(true);
    if (state.round.phase !== 'revealed') throw new Error('Expected a revealed round');
    return state.round;
};

describe('Leaving after the result is known', () => {
    it('drops the vote of whoever leaves while voting is open', () => {
        const fixture = votedRoom(0);
        const { room, owner, bia } = fixture;
        room.leave(bia.id);
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        expect(revealedVotes(fixture).votes.map((vote) => vote.name)).toEqual(['Ana']);
        expect(revealedVotes(fixture).kiroGuesses).toEqual([]);
        expect(room.history[0].votes).toEqual([{ name: 'Ana', value: 'P' }]);
    });

    it('freezes the votes of who leaves during the countdown, including the owned Kiro', () => {
        const fixture = votedRoom(3);
        const { room, owner, bia } = fixture;
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        room.leave(bia.id);
        room.finishCountdown(1);
        const round = revealedVotes(fixture);
        expect(round.votes.map((vote) => [vote.name, vote.value])).toEqual([
            ['Ana', 'P'],
            ['Bia', 'M'],
        ]);
        expect(round.kiroGuesses.map((guess) => [guess.name, guess.value, guess.rationale])).toEqual([
            ['Kiro do Bia', 'G', 'Parece grande'],
        ]);
        expect(room.history[0].votes.map((vote) => vote.name)).toEqual(['Ana', 'Bia']);
        expect(room.history[0].kiroGuesses.map((guess) => guess.name)).toEqual(['Kiro do Bia']);
    });

    it('keeps the votes of who leaves after the reveal until the next hand', () => {
        const fixture = votedRoom(0);
        const { room, owner, bia } = fixture;
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        room.leave(bia.id);
        const round = revealedVotes(fixture);
        expect(round.votes.map((vote) => vote.name)).toEqual(['Ana', 'Bia']);
        expect(round.kiroGuesses.map((guess) => guess.name)).toEqual(['Kiro do Bia']);
        expect(room.participants.map((participant) => participant.name)).toEqual(['Ana']);
        room.reset(owner.id, { roundId: 1 });
        room.vote(owner.id, { roundId: 2, value: 'P' });
        room.reveal(owner.id, { roundId: 2, confirmMissingVotes: false });
        expect(revealedVotes(fixture).votes.map((vote) => vote.name)).toEqual(['Ana']);
        expect(revealedVotes(fixture).kiroGuesses).toEqual([]);
    });

    it('does not freeze a leaver that never voted', () => {
        const fixture = createRoomFixture({ settings: { countdownSeconds: 0 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.reveal(fixture.owner.id, { roundId: 1, confirmMissingVotes: true });
        fixture.room.leave(bia.id);
        const state = snapshotFor(fixture.room, fixture.owner.id);
        if (state.round.phase !== 'revealed') throw new Error('Expected a revealed round');
        expect(state.round.votes.map((vote) => vote.name)).toEqual(['Ana']);
    });
});
