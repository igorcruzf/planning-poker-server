import { DomainError } from './domain-error';
import { DISCONNECTED_PARTICIPANT_TTL_MS, MAX_PARTICIPANTS_PER_ROOM } from './room';
import { createRoomFixture } from './testing/room-fixtures';

const roomFull = { code: 'invalid_payload', issues: [{ path: 'room', message: 'room_full' }] };

const fillRoom = (fixture: ReturnType<typeof createRoomFixture>) => {
    const guests = [];
    while (fixture.room.participants.length < MAX_PARTICIPANTS_PER_ROOM) {
        guests.push(fixture.join(`Guest ${fixture.room.participants.length}`));
    }
    return guests;
};

describe('Room capacity', () => {
    it('refuses the join that would exceed the participant limit with room_full', () => {
        const fixture = createRoomFixture();
        fillRoom(fixture);
        expect(() => fixture.join('Extra')).toThrow(DomainError);
        try {
            fixture.join('Extra');
        } catch (error) {
            expect((error as DomainError).error).toEqual(roomFull);
        }
        expect(fixture.room.participants).toHaveLength(MAX_PARTICIPANTS_PER_ROOM);
    });

    it('counts Kiro seats toward the limit', () => {
        const fixture = createRoomFixture({ settings: { allowKiro: true } });
        const guests = fillRoom(fixture);
        fixture.room.leave(guests[0].id);
        const invite = fixture.room.createKiroInvite(fixture.owner.id);
        fixture.room.redeemKiroInvite(invite.inviteCode);
        expect(fixture.room.participants).toHaveLength(MAX_PARTICIPANTS_PER_ROOM);
        expect(() => fixture.join('Extra')).toThrow(DomainError);
    });

    it('refuses a Kiro seat when the room is full', () => {
        const fixture = createRoomFixture({ settings: { allowKiro: true } });
        const invite = fixture.room.createKiroInvite(fixture.owner.id);
        fillRoom(fixture);
        expect(() => fixture.room.redeemKiroInvite(invite.inviteCode)).toThrow(DomainError);
    });

    it('lets reconnection through even when the room is full', () => {
        const fixture = createRoomFixture();
        fillRoom(fixture);
        const { sessionToken } = { sessionToken: fixture.owner.token };
        expect(() => fixture.room.join({ name: 'Ana', role: 'player', sessionToken })).not.toThrow();
    });

    it('frees the seat when someone leaves so another can join', () => {
        const fixture = createRoomFixture();
        const guests = fillRoom(fixture);
        fixture.room.leave(guests[3].id);
        expect(fixture.room.participants.some((participant) => participant.id === guests[3].id)).toBe(false);
        expect(() => fixture.join('Newcomer')).not.toThrow();
        expect(fixture.room.participants).toHaveLength(MAX_PARTICIPANTS_PER_ROOM);
    });
});

describe('Leaving removes the seat but keeps the frozen vote', () => {
    it('drops the vote of someone who leaves during voting and settles the auto reveal', () => {
        const fixture = createRoomFixture({ settings: { autoReveal: true, countdownSeconds: 0 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        expect(fixture.room.pendingVoterIds()).toEqual([bia.id]);
        fixture.room.leave(bia.id);
        expect(fixture.room.pendingVoterIds()).toEqual([]);
        expect(fixture.room.phase).toBe('revealed');
        expect(fixture.room.ballots.map((ballot) => ballot.name)).toEqual(['Ana']);
    });

    it('keeps the ballot of someone who leaves during the countdown', () => {
        const fixture = createRoomFixture({ settings: { countdownSeconds: 3 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.vote(bia.id, { roundId: 1, value: 'M' });
        fixture.room.reveal(fixture.owner.id, { roundId: 1, confirmMissingVotes: false });
        fixture.room.leave(bia.id);
        expect(fixture.room.participants.map((participant) => participant.name)).toEqual(['Ana']);
        fixture.room.finishCountdown(1);
        expect(fixture.room.history[0].votes.map((vote) => vote.name)).toEqual(['Ana', 'Bia']);
    });

    it('keeps the ballot of someone who leaves after the reveal', () => {
        const fixture = createRoomFixture({ settings: { countdownSeconds: 0 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.vote(bia.id, { roundId: 1, value: 'M' });
        fixture.room.reveal(fixture.owner.id, { roundId: 1, confirmMissingVotes: false });
        fixture.room.leave(bia.id);
        expect(fixture.room.participants.map((participant) => participant.name)).toEqual(['Ana']);
        expect(fixture.room.ballots.map((ballot) => ballot.name).sort()).toEqual(['Ana', 'Bia']);
    });
});

describe('Pruning participants disconnected for too long', () => {
    it('removes humans disconnected for more than 15 minutes and their Kiros', () => {
        const fixture = createRoomFixture({ settings: { allowKiro: true } });
        const bia = fixture.join('Bia');
        const invite = fixture.room.createKiroInvite(bia.id);
        fixture.room.redeemKiroInvite(invite.inviteCode);
        fixture.room.markDisconnected(bia.id);
        fixture.clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS);
        expect(fixture.room.pruneAbsent(fixture.clock.now())).toBe(false);
        fixture.clock.advance(1);
        expect(fixture.room.pruneAbsent(fixture.clock.now())).toBe(true);
        expect(fixture.room.participants.map((participant) => participant.name)).toEqual(['Ana']);
    });

    it('keeps connected participants and recent absences', () => {
        const fixture = createRoomFixture();
        const bia = fixture.join('Bia');
        fixture.room.markDisconnected(bia.id);
        fixture.clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS - 1);
        expect(fixture.room.pruneAbsent(fixture.clock.now())).toBe(false);
        expect(fixture.room.participants).toHaveLength(2);
    });

    it('hands the facilitation to a connected human when the facilitator is pruned', () => {
        const fixture = createRoomFixture();
        const bia = fixture.join('Bia');
        fixture.room.markDisconnected(fixture.owner.id);
        fixture.clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS + 1);
        fixture.room.pruneAbsent(fixture.clock.now());
        expect(fixture.room.facilitatorId).toBe(bia.id);
    });

    it('leaves no facilitator when the pruned facilitator was the last human', () => {
        const fixture = createRoomFixture();
        fixture.room.markDisconnected(fixture.owner.id);
        fixture.clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS + 1);
        fixture.room.pruneAbsent(fixture.clock.now());
        expect(fixture.room.participants).toEqual([]);
        expect(fixture.room.facilitatorId).toBeNull();
    });

    it('settles the auto reveal when a pruned player was the only pending voter', () => {
        const fixture = createRoomFixture({ settings: { autoReveal: true, countdownSeconds: 0 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.markDisconnected(bia.id);
        fixture.clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS + 1);
        fixture.room.pruneAbsent(fixture.clock.now());
        expect(fixture.room.pendingVoterIds()).toEqual([]);
        expect(fixture.room.phase).toBe('revealed');
    });

    it('freezes the vote of a pruned player after the reveal', () => {
        const fixture = createRoomFixture({ settings: { countdownSeconds: 0 } });
        const bia = fixture.join('Bia');
        fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
        fixture.room.vote(bia.id, { roundId: 1, value: 'M' });
        fixture.room.reveal(fixture.owner.id, { roundId: 1, confirmMissingVotes: false });
        fixture.room.markDisconnected(bia.id);
        fixture.clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS + 1);
        fixture.room.pruneAbsent(fixture.clock.now());
        expect(fixture.room.ballots.map((ballot) => ballot.name).sort()).toEqual(['Ana', 'Bia']);
    });
});
