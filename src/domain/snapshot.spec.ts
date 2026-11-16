import { RoomState, roomStateSchema } from '../contracts';
import { Room } from './room';
import { ANONYMOUS_VIEWER_ID, snapshotFor } from './snapshot';
import { createRoomFixture, RoomFixture, TEST_SERVER_INSTANCE_ID } from './testing/room-fixtures';

const parsed = (room: Room, viewerId: string | null): RoomState => roomStateSchema.parse(snapshotFor(room, viewerId));

interface Table extends RoomFixture {
    bia: { id: string; token: string };
    leo: { id: string; token: string };
    kiroId: string;
}

const table = (): Table => {
    const fixture = createRoomFixture({ settings: { allowKiro: true } });
    const bia = fixture.join('Bia');
    const leo = fixture.join('Leo', 'spectator');
    const kiro = fixture.room.redeemKiroInvite(fixture.room.createKiroInvite(fixture.owner.id).inviteCode);
    fixture.room.vote(fixture.owner.id, { roundId: 1, value: 'P' });
    fixture.room.vote(bia.id, { roundId: 1, value: 'G' });
    fixture.room.castKiroVote(kiro.participantId, { value: 'M', rationale: 'Segredo do Kiro' });
    return { ...fixture, bia, leo, kiroId: kiro.participantId };
};

const reveal = (current: Table) => {
    current.room.reveal(current.owner.id, { roundId: 1, confirmMissingVotes: false });
    current.room.finishCountdown(1);
};

describe('snapshotFor in the voting phase', () => {
    it('passes the contract for every viewer and never leaks a vote, rationale or token', () => {
        const current = table();
        const ownVotes = new Map([
            [current.owner.id, 'P'],
            [current.bia.id, 'G'],
            [current.leo.id, null],
            [current.kiroId, 'M'],
        ]);
        const secrets = ['Segredo do Kiro', current.owner.token, current.bia.token, current.leo.token];
        for (const viewer of [...ownVotes.keys(), null]) {
            const state = parsed(current.room, viewer);
            const serialized = JSON.stringify(state);
            expect(state.round.phase).toBe('voting');
            expect(state.round).not.toHaveProperty('votes');
            expect(state.round).not.toHaveProperty('kiroGuesses');
            expect(state.self.vote).toBe(viewer === null ? null : ownVotes.get(viewer));
            secrets.forEach((secret) => expect(serialized).not.toContain(secret));
            expect(serialized).not.toContain('tokenHash');
            expect(serialized).not.toContain('rationale');
        }
    });

    it('shows each viewer only their own vote in self', () => {
        const current = table();
        expect(parsed(current.room, current.owner.id).self).toEqual({ participantId: current.owner.id, vote: 'P' });
        expect(parsed(current.room, current.bia.id).self.vote).toBe('G');
        expect(parsed(current.room, current.leo.id).self.vote).toBeNull();
        expect(parsed(current.room, null).self).toEqual({ participantId: ANONYMOUS_VIEWER_ID, vote: null });
    });

    it('lists participants with presence, flags and the Kiro owner, but no vote values', () => {
        const current = table();
        const { participants } = parsed(current.room, current.bia.id);
        expect(participants.map((participant) => participant.name)).toEqual(['Ana', 'Bia', 'Leo', 'Kiro do Ana']);
        expect(participants[0]).toMatchObject({ isFacilitator: true, hasVoted: true, presence: 'connected' });
        expect(participants[2]).toMatchObject({ role: 'spectator', hasVoted: false });
        expect(participants[3]).toMatchObject({ role: 'bot', ownerId: current.owner.id, hasVoted: true });
        expect(participants.every((participant) => !('vote' in participant) && !('tokenHash' in participant))).toBe(true);
    });

    it('lists the players still missing a vote in pendingVoterIds', () => {
        const fixture = createRoomFixture();
        const bia = fixture.join('Bia');
        fixture.join('Leo', 'spectator');
        const state = parsed(fixture.room, bia.id);
        expect(state.round).toEqual({ id: 1, issueKey: null, phase: 'voting', pendingVoterIds: [fixture.owner.id, bia.id] });
    });

    it('carries room data, settings, serverInstanceId and a null jira', () => {
        const current = table();
        const state = parsed(current.room, current.owner.id);
        expect(state.serverInstanceId).toBe(TEST_SERVER_INSTANCE_ID);
        expect(state.room).toEqual({ code: current.room.code, name: 'Sprint', createdAt: current.room.createdAt });
        expect(state.settings.allowKiro).toBe(true);
        expect(state.history).toEqual([]);
        expect(state.jira).toBeNull();
    });

    it('does not share references with the room, so callers cannot mutate it', () => {
        const current = table();
        const state = snapshotFor(current.room, current.owner.id);
        state.settings.deck.cards.push({ value: 'XXL' });
        state.participants.pop();
        expect(current.room.settings.deck.cards).toHaveLength(4);
        expect(current.room.participants).toHaveLength(4);
    });
});

describe('snapshotFor in the countdown phase', () => {
    it('keeps votes hidden and exposes the reveal time', () => {
        const current = table();
        current.room.reveal(current.owner.id, { roundId: 1, confirmMissingVotes: false });
        const state = parsed(current.room, current.leo.id);
        expect(state.round).toMatchObject({ phase: 'countdown', countdownMs: 3000, pendingVoterIds: [] });
        expect(JSON.stringify(state)).not.toContain('Segredo do Kiro');
    });
});

describe('snapshotFor in the revealed phase', () => {
    it('shows every vote and the Kiro guess with rationale, separated, for every viewer', () => {
        const current = table();
        reveal(current);
        for (const viewer of [current.owner.id, current.leo.id, current.kiroId, null]) {
            const { round } = parsed(current.room, viewer);
            expect(round).toMatchObject({
                phase: 'revealed',
                votes: [
                    { participantId: current.owner.id, name: 'Ana', value: 'P' },
                    { participantId: current.bia.id, name: 'Bia', value: 'G' },
                ],
                kiroGuesses: [
                    { participantId: current.kiroId, name: 'Kiro do Ana', value: 'M', rationale: 'Segredo do Kiro' },
                ],
                finalEstimate: null,
            });
        }
    });

    it('never exposes tokens even after the reveal', () => {
        const current = table();
        reveal(current);
        const serialized = JSON.stringify(parsed(current.room, current.owner.id));
        [current.owner.token, current.bia.token, current.leo.token].forEach((token) =>
            expect(serialized).not.toContain(token),
        );
    });

    it('adds the final estimate and the history', () => {
        const current = table();
        reveal(current);
        current.room.finalize(current.owner.id, { roundId: 1, value: 'P' });
        const state = parsed(current.room, current.bia.id);
        expect(state.round).toMatchObject({ finalEstimate: 'P' });
        expect(state.history).toHaveLength(1);
        expect(state.history[0].finalEstimate).toEqual({ value: 'P', meaning: 'até 5 dias' });
    });

    it('hides the votes again after a new hand', () => {
        const current = table();
        reveal(current);
        current.room.reset(current.bia.id, { roundId: 1 });
        const state = parsed(current.room, current.owner.id);
        expect(state.round.phase).toBe('voting');
        expect(state.round).toMatchObject({ id: 2, pendingVoterIds: [current.owner.id, current.bia.id] });
        expect(state.self.vote).toBeNull();
    });

    it('reports the issue key of the current card in every phase', () => {
        const current = table();
        current.room.setCurrentIssue(current.owner.id, { key: 'YAK-7', summary: 'Login' });
        expect(parsed(current.room, null).round).toMatchObject({ issueKey: 'YAK-7' });
        reveal(current);
        expect(parsed(current.room, null).round).toMatchObject({ issueKey: 'YAK-7' });
    });

    it('passes through the Jira state when the room has one', () => {
        const current = table();
        current.room.setJiraState({ connected: true, agenda: [], currentIssue: null });
        expect(parsed(current.room, null).jira).toEqual({ connected: true, agenda: [], currentIssue: null });
    });
});
