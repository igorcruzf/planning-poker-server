import { DISCONNECTED_PLAYER_GRACE_MS } from '../contracts';
import { createRoomFixture } from './testing/room-fixtures';

const autoRevealFixture = () => {
    const fixture = createRoomFixture({ settings: { autoReveal: true, countdownSeconds: 0 } });
    const bia = fixture.join('Bia');
    return { ...fixture, bia };
};

describe('Disconnection tolerance', () => {
    it('counts the 30 seconds from the first disconnect even when disconnect is repeated', () => {
        const { room, clock, bia } = autoRevealFixture();
        room.markDisconnected(bia.id);
        clock.advance(20_000);
        room.markDisconnected(bia.id);
        clock.advance(11_000);
        expect(room.pendingVoterIds()).not.toContain(bia.id);
        expect(room.requireParticipant(bia.id).disconnectedAt).toBe(clock.now() - 31_000);
    });
});

describe('Next presence deadline', () => {
    it('is null when nobody is disconnected', () => {
        const { room } = autoRevealFixture();
        expect(room.nextPresenceDeadline()).toBeNull();
    });

    it('is the earliest disconnect plus the grace period among pending players', () => {
        const { room, clock, owner, bia } = autoRevealFixture();
        const first = clock.now();
        room.markDisconnected(bia.id);
        clock.advance(5_000);
        room.markDisconnected(owner.id);
        expect(room.nextPresenceDeadline()).toBe(first + DISCONNECTED_PLAYER_GRACE_MS);
    });

    it('is null outside the voting phase', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.markDisconnected(bia.id);
        expect(room.nextPresenceDeadline()).not.toBeNull();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: true });
        expect(room.phase).toBe('revealed');
        expect(room.nextPresenceDeadline()).toBeNull();
    });

    it('is null during the countdown', () => {
        const { room, clock, owner, join } = createRoomFixture({ settings: { autoReveal: true, countdownSeconds: 3 } });
        const bia = join('Bia');
        room.markDisconnected(bia.id);
        clock.advance(DISCONNECTED_PLAYER_GRACE_MS);
        room.vote(owner.id, { roundId: 1, value: 'P' });
        expect(room.phase).toBe('countdown');
        expect(room.nextPresenceDeadline()).toBeNull();
    });

    it('is the grace deadline of a disconnected pending player even when the auto reveal is off', () => {
        const { room, clock, bia } = autoRevealFixture();
        room.updateSettings(room.facilitatorId!, { autoReveal: false });
        const disconnectedAt = clock.now();
        room.markDisconnected(bia.id);
        expect(room.nextPresenceDeadline()).toBe(disconnectedAt + DISCONNECTED_PLAYER_GRACE_MS);
    });

    it('ignores players that already voted, spectators, and deadlines already past', () => {
        const { room, clock, owner, bia, join } = autoRevealFixture();
        const leo = join('Leo', 'spectator');
        room.markDisconnected(leo.id);
        room.vote(bia.id, { roundId: 1, value: 'P' });
        room.markDisconnected(bia.id);
        expect(room.nextPresenceDeadline()).toBeNull();
        room.markDisconnected(owner.id);
        clock.advance(DISCONNECTED_PLAYER_GRACE_MS);
        expect(room.nextPresenceDeadline()).toBeNull();
    });
});

describe('Read-only copies', () => {
    it('does not let the caller change the history or the Jira state of the room', () => {
        const { room, owner } = createRoomFixture({ settings: { countdownSeconds: 0 } });
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.reveal(owner.id, { roundId: 1, confirmMissingVotes: false });
        room.setJiraState({ connected: true, agenda: [], currentIssue: null });
        room.history[0].votes[0].value = 'XX';
        room.jira!.agenda.push({ key: 'YAK-1', summary: 'Card' } as never);
        expect(room.history[0].votes).toEqual([{ name: 'Ana', value: 'P' }]);
        expect(room.jira!.agenda).toEqual([]);
    });
});

describe('Auto reveal re-evaluation', () => {
    it('reveals when the last pending player leaves', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.leave(bia.id);
        expect(room.phase).toBe('revealed');
    });

    it('reveals when the last pending player becomes a spectator', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.setRole(bia.id, 'spectator');
        expect(room.phase).toBe('revealed');
    });

    it('reveals when the last pending player disconnected and the grace period is settled', () => {
        const { room, clock, owner, bia } = autoRevealFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.markDisconnected(bia.id);
        expect(room.phase).toBe('voting');
        clock.advance(DISCONNECTED_PLAYER_GRACE_MS);
        expect(room.settle()).toEqual({ phase: 'revealed' });
    });

    it('keeps voting when a special cards change clears a vote and leaves a player pending', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.vote(owner.id, { roundId: 1, value: '?' });
        room.updateSettings(owner.id, { specialCards: [] });
        expect(room.phase).toBe('voting');
        expect(room.pendingVoterIds()).toEqual([owner.id, bia.id]);
    });

    it('enters the countdown when the countdown is configured', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.updateSettings(owner.id, { countdownSeconds: 3 });
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.leave(bia.id);
        expect(room.phase).toBe('countdown');
    });

    it('does nothing when nobody voted yet', () => {
        const { room, bia } = autoRevealFixture();
        room.leave(bia.id);
        expect(room.phase).toBe('voting');
    });

    it('does nothing when autoReveal is off', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.updateSettings(owner.id, { autoReveal: false });
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.leave(bia.id);
        expect(room.settle()).toEqual({ phase: 'voting' });
    });

    it('does nothing when only the Kiro voted', () => {
        const { room, owner, bia } = autoRevealFixture();
        room.updateSettings(owner.id, { allowKiro: true });
        const invite = room.createKiroInvite(owner.id);
        const kiro = room.redeemKiroInvite(invite.inviteCode);
        room.castKiroVote(kiro.participantId, { value: 'P', rationale: 'Parece pequeno' });
        room.setRole(owner.id, 'spectator');
        room.leave(bia.id);
        expect(room.phase).toBe('voting');
    });

    it('does not reveal a room that still has a pending player', () => {
        const { room, owner, bia, join } = autoRevealFixture();
        join('Caio');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.leave(bia.id);
        expect(room.phase).toBe('voting');
    });
});
