import {
    getRoundOutputSchema,
    JiraRoomState,
    WAIT_FOR_ROUND_MAX_TIMEOUT_S,
    waitForRoundOutputSchema,
} from '../contracts';
import { DomainError } from '../domain/domain-error';
import { KiroSession } from './kiro-session';
import { createTableFixture } from './testing/table-fixture';
const errorOf = (action: () => unknown) => {
    try {
        action();
    } catch (error) {
        if (error instanceof DomainError) return error.error;
        throw error;
    }
    throw new Error('Expected a DomainError');
};
const asyncErrorOf = async (action: () => Promise<unknown>) => {
    try {
        await action();
    } catch (error) {
        if (error instanceof DomainError) return error.error;
        throw error;
    }
    throw new Error('Expected a DomainError');
};
const JIRA_ISSUE = {
    key: 'YAK-1',
    summary: 'Pagamento',
    issueType: 'Story',
    status: 'To Do',
    size: null,
    url: 'https://jira.example.com/browse/YAK-1',
    assignee: null,
    descriptionHtml: null,
    sizeField: null,
};
const jiraState = (key: string): JiraRoomState => ({
    connected: true,
    agenda: [],
    currentIssue: {
        ...JIRA_ISSUE,
        key,
        url: `https://jira.example.com/browse/${key}`,
    },
});
describe('KiroTableService', () => {
    describe('join', () => {
        it('seats the Kiro as "Kiro do {dono}" and binds the session to the seat', () => {
            const { createRoom, seatKiro, rooms } = createTableFixture();
            const owner = createRoom('Ana');
            const { session, joined } = seatKiro(owner);
            expect(joined).toMatchObject({
                seatName: 'Kiro do Ana',
                roomName: 'Sprint',
            });
            expect(session.seat).toEqual({
                roomCode: owner.roomCode,
                participantId: joined.participantId,
            });
            const seated = rooms.snapshot(owner.roomCode, owner.participantId).participants;
            expect(seated.find(({ id }) => id === joined.participantId)).toMatchObject({
                role: 'bot',
                ownerId: owner.participantId,
            });
        });
        it('refuses an unknown invite', () => {
            const { table } = createTableFixture();
            expect(errorOf(() => table.join(new KiroSession(), 'x'.repeat(43)))).toEqual({ code: 'invite_invalid' });
        });
        it('refuses a reused invite', () => {
            const { createRoom, seatKiro, table } = createTableFixture();
            const { inviteCode } = seatKiro(createRoom());
            expect(errorOf(() => table.join(new KiroSession(), inviteCode))).toEqual({
                code: 'invite_invalid',
            });
        });
        it('refuses an expired invite', () => {
            const { clock, createRoom, rooms, table } = createTableFixture();
            const owner = createRoom();
            const { inviteCode } = rooms.createKiroInvite(owner.roomCode, owner.participantId);
            clock.advance(10 * 60 * 1000 + 1);
            expect(errorOf(() => table.join(new KiroSession(), inviteCode))).toEqual({
                code: 'invite_invalid',
            });
        });
        it('refuses a second join in a session that is already seated', () => {
            const { createRoom, seatKiro, rooms, table } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const other = createRoom('Bia');
            const { inviteCode } = rooms.createKiroInvite(other.roomCode, other.participantId);
            expect(errorOf(() => table.join(session, inviteCode))).toEqual({
                code: 'invite_invalid',
            });
        });
        it('refuses when the room turned Kiro off after the invite', () => {
            const { createRoom, rooms, table } = createTableFixture();
            const owner = createRoom();
            const { inviteCode } = rooms.createKiroInvite(owner.roomCode, owner.participantId);
            rooms.updateSettings(owner.roomCode, owner.participantId, {
                allowKiro: false,
            });
            expect(errorOf(() => table.join(new KiroSession(), inviteCode))).toEqual({
                code: 'kiro_disabled',
            });
        });
    });
    describe('tools without a seat', () => {
        it.each([
            ['get_round', (table: ReturnType<typeof createTableFixture>['table'], s: KiroSession) => table.getRound(s)],
            [
                'cast_vote',
                (table: ReturnType<typeof createTableFixture>['table'], s: KiroSession) =>
                    table.castVote(s, { value: 'PP', rationale: 'ok' }),
            ],
            ['leave_table', (table: ReturnType<typeof createTableFixture>['table'], s: KiroSession) => table.leave(s)],
        ])('%s answers forbidden/not_in_room', (_name, call) => {
            const { table } = createTableFixture();
            expect(errorOf(() => call(table, new KiroSession()))).toEqual({
                code: 'forbidden',
                reason: 'not_in_room',
            });
        });
        it('wait_for_round answers forbidden/not_in_room', async () => {
            const { table } = createTableFixture();
            expect(await asyncErrorOf(() => table.waitForRound(new KiroSession(), 5))).toEqual({
                code: 'forbidden',
                reason: 'not_in_room',
            });
        });
    });
    describe('get_round', () => {
        it('returns the room deck with the ruler, the phase and no votes while voting', () => {
            const { createRoom, seatKiro, table } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const round = table.getRound(session);
            expect(getRoundOutputSchema.parse(round)).toEqual(round);
            expect(round).toMatchObject({
                roomName: 'Sprint',
                issue: null,
                kiroCountsAsPlayer: false,
                yourVote: null,
                round: { id: 1, phase: 'voting' },
            });
            expect(round.deck.cards.map(({ value }) => value)).toEqual(['PP', 'P', 'M', 'G']);
            expect(round.deck.cards[0]).toEqual({
                value: 'PP',
                meaning: 'até 3 dias',
            });
            expect(round.deck.specialCards).toEqual(['?', 'yakult']);
        });
        it('never shows the votes of the others before the reveal', () => {
            const { createRoom, joinHuman, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const bia = joinHuman(owner.roomCode, 'Bia');
            const { session } = seatKiro(owner);
            rooms.vote(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'PP',
            });
            rooms.vote(owner.roomCode, bia.participantId, { roundId: 1, value: 'G' });
            const serialized = JSON.stringify(table.getRound(session));
            expect(table.getRound(session).round).toEqual({ id: 1, phase: 'voting' });
            expect(serialized).not.toContain('Bia');
            expect(serialized).not.toContain('votes');
            expect(serialized).not.toContain('pendingVoterIds');
        });
        it('keeps the votes hidden during the countdown', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom('Ana', { allowKiro: true, countdownSeconds: 3 });
            const { session } = seatKiro(owner);
            rooms.vote(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'PP',
            });
            rooms.reveal(owner.roomCode, owner.participantId, {
                roundId: 1,
                confirmMissingVotes: true,
            });
            const { round } = table.getRound(session);
            expect(round.phase).toBe('countdown');
            expect(JSON.stringify(round)).not.toContain('PP');
        });
        it('shows the players votes, the final estimate and its own vote after the reveal', () => {
            const { createRoom, joinHuman, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom('Ana', { allowKiro: true, countdownSeconds: 0 });
            const bia = joinHuman(owner.roomCode, 'Bia');
            const { session } = seatKiro(owner);
            table.castVote(session, { value: 'M', rationale: 'Parece médio' });
            rooms.vote(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'PP',
            });
            rooms.vote(owner.roomCode, bia.participantId, { roundId: 1, value: 'G' });
            rooms.reveal(owner.roomCode, owner.participantId, {
                roundId: 1,
                confirmMissingVotes: true,
            });
            rooms.finalize(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'P',
            });
            const result = table.getRound(session);
            expect(result.yourVote).toEqual({
                value: 'M',
                rationale: 'Parece médio',
            });
            expect(result.round).toMatchObject({
                id: 1,
                phase: 'revealed',
                finalEstimate: 'P',
            });
            expect(
                result.round.phase === 'revealed' &&
                    [...result.round.votes].sort((a, b) => a.name.localeCompare(b.name)),
            ).toEqual([
                { name: 'Ana', value: 'PP' },
                { name: 'Bia', value: 'G' },
            ]);
        });
        it('describes the current card with the data from Jira', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            rooms.setCurrentIssue(owner.roomCode, owner.participantId, {
                key: 'YAK-1',
                summary: 'Pagamento',
            });
            rooms.setJiraState(owner.roomCode, jiraState('YAK-1'));
            expect(table.getRound(session).issue).toEqual({
                key: 'YAK-1',
                summary: 'Pagamento',
                issueType: 'Story',
                url: 'https://jira.example.com/browse/YAK-1',
            });
        });
        it('has no card when Jira does not describe the current one', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            rooms.setCurrentIssue(owner.roomCode, owner.participantId, {
                key: 'YAK-2',
                summary: 'Outro',
            });
            rooms.setJiraState(owner.roomCode, jiraState('YAK-1'));
            expect(table.getRound(session).issue).toBeNull();
        });
        it('fails once the seat is gone', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            rooms.leave(owner.roomCode, owner.participantId);
            expect(errorOf(() => table.getRound(session))).toMatchObject({
                code: expect.stringMatching(/forbidden|room_not_found/),
            });
        });
    });
    describe('cast_vote', () => {
        it('records the vote hidden from the other seats', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session, joined } = seatKiro(owner);
            const result = table.castVote(session, {
                value: 'PP',
                rationale: 'Pequeno',
            });
            expect(result).toEqual({ roundId: 1, value: 'PP', rationale: 'Pequeno' });
            const seen = rooms.snapshot(owner.roomCode, owner.participantId);
            expect(JSON.stringify(seen)).not.toContain('Pequeno');
            expect(seen.round.phase).toBe('voting');
            expect(seen.participants.find(({ id }) => id === joined.participantId)?.hasVoted).toBe(true);
        });
        it('allows changing the vote until the reveal', () => {
            const { createRoom, seatKiro, table } = createTableFixture();
            const { session } = seatKiro(createRoom());
            table.castVote(session, { value: 'PP', rationale: 'a' });
            table.castVote(session, { value: 'G', rationale: 'b' });
            expect(table.getRound(session).yourVote).toEqual({
                value: 'G',
                rationale: 'b',
            });
        });
        it('refuses a value outside the deck', () => {
            const { createRoom, seatKiro, table } = createTableFixture();
            const { session } = seatKiro(createRoom());
            expect(errorOf(() => table.castVote(session, { value: 'XX', rationale: 'a' }))).toEqual({
                code: 'invalid_vote',
            });
        });
        it('refuses to vote after the reveal', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom('Ana', { allowKiro: true, countdownSeconds: 0 });
            const { session } = seatKiro(owner);
            rooms.vote(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'PP',
            });
            rooms.reveal(owner.roomCode, owner.participantId, {
                roundId: 1,
                confirmMissingVotes: true,
            });
            expect(errorOf(() => table.castVote(session, { value: 'PP', rationale: 'a' }))).toEqual({
                code: 'wrong_phase',
                phase: 'revealed',
            });
        });
        it('does not block the reveal nor trigger the auto reveal', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom('Ana', { allowKiro: true, autoReveal: true });
            const { session } = seatKiro(owner);
            table.castVote(session, { value: 'PP', rationale: 'a' });
            expect(rooms.getRoom(owner.roomCode).phase).toBe('voting');
            rooms.vote(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'PP',
            });
            expect(rooms.getRoom(owner.roomCode).phase).not.toBe('voting');
        });
    });
    describe('leave', () => {
        it('frees the seat and closes the session', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session, joined } = seatKiro(owner);
            expect(table.leave(session)).toEqual({ left: true });
            expect(session.isClosed).toBe(true);
            expect(rooms.snapshot(owner.roomCode, owner.participantId).participants.map(({ id }) => id)).not.toContain(
                joined.participantId,
            );
            const second = seatKiro(owner);
            expect(second.joined.seatName).toBe('Kiro do Ana');
        });
        it('closes the session even if the seat was already removed', () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session, joined } = seatKiro(owner);
            rooms.leave(owner.roomCode, joined.participantId);
            expect(table.leave(session)).toEqual({ left: true });
            expect(session.isClosed).toBe(true);
        });
    });
    describe('wait_for_round', () => {
        it('wakes up on a new round', async () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const waiting = table.waitForRound(session, 60);
            rooms.reset(owner.roomCode, owner.participantId, { roundId: 1 });
            const result = await waiting;
            expect(waitForRoundOutputSchema.parse(result)).toEqual(result);
            expect(result).toMatchObject({
                change: 'new_round',
                round: { id: 2, phase: 'voting' },
            });
        });
        it('wakes up when the card changes', async () => {
            const { createRoom, seatKiro, table, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const waiting = table.waitForRound(session, 60);
            rooms.setCurrentIssue(owner.roomCode, owner.participantId, {
                key: 'YAK-5',
                summary: 'Novo',
            });
            expect((await waiting).change).toBe('issue_changed');
        });
        it('returns at once when the round already changed since the last look', async () => {
            const { createRoom, seatKiro, table, rooms, scheduler } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            rooms.reset(owner.roomCode, owner.participantId, { roundId: 1 });
            expect((await table.waitForRound(session, 60)).change).toBe('new_round');
            expect(scheduler.pendingCount).toBe(0);
        });
        it('does not wake up for changes that keep round and card', async () => {
            const { createRoom, joinHuman, seatKiro, table, scheduler, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const waiting = table.waitForRound(session, 60);
            joinHuman(owner.roomCode, 'Bia');
            rooms.vote(owner.roomCode, owner.participantId, {
                roundId: 1,
                value: 'PP',
            });
            scheduler.advance(59_999);
            let settled = false;
            void waiting.then(() => (settled = true));
            await Promise.resolve();
            expect(settled).toBe(false);
            scheduler.advance(1);
            expect((await waiting).change).toBe('timeout');
        });
        it('times out at the 90 s ceiling with a fake clock and leaves no timer', async () => {
            const { createRoom, seatKiro, table, scheduler } = createTableFixture();
            const { session } = seatKiro(createRoom());
            const waiting = table.waitForRound(session, WAIT_FOR_ROUND_MAX_TIMEOUT_S);
            expect(scheduler.pendingCount).toBe(1);
            scheduler.advance(WAIT_FOR_ROUND_MAX_TIMEOUT_S * 1000);
            expect((await waiting).change).toBe('timeout');
            expect(scheduler.pendingCount).toBe(0);
        });
        it('unsubscribes from onChange when it finishes', async () => {
            const { createRoom, seatKiro, table, scheduler, rooms } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const unsubscribe = jest.fn();
            const original = rooms.onChange.bind(rooms);
            jest.spyOn(rooms, 'onChange').mockImplementation((listener) => {
                const cancel = original(listener);
                return () => {
                    unsubscribe();
                    cancel();
                };
            });
            const waiting = table.waitForRound(session, 5);
            scheduler.advance(5000);
            await waiting;
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
        it('is cancelled when the session closes', async () => {
            const { createRoom, seatKiro, table, scheduler } = createTableFixture();
            const owner = createRoom();
            const { session } = seatKiro(owner);
            const waiting = table.waitForRound(session, 60);
            const outcome = asyncErrorOf(() => waiting);
            session.close();
            expect(await outcome).toEqual({
                code: 'forbidden',
                reason: 'not_in_room',
            });
            expect(scheduler.pendingCount).toBe(0);
        });
        it('is cancelled by leave_table', async () => {
            const { createRoom, seatKiro, table, scheduler } = createTableFixture();
            const { session } = seatKiro(createRoom());
            const waiting = asyncErrorOf(() => table.waitForRound(session, 60));
            table.leave(session);
            expect(await waiting).toEqual({
                code: 'forbidden',
                reason: 'not_in_room',
            });
            expect(scheduler.pendingCount).toBe(0);
        });
        it('fails when the seat disappears while waiting', async () => {
            const { createRoom, seatKiro, table, scheduler, rooms } = createTableFixture();
            const owner = createRoom();
            const { session, joined } = seatKiro(owner);
            const waiting = asyncErrorOf(() => table.waitForRound(session, 60));
            rooms.leave(owner.roomCode, joined.participantId);
            expect(await waiting).toEqual({
                code: 'forbidden',
                reason: 'not_in_room',
            });
            expect(scheduler.pendingCount).toBe(0);
        });
        it('allows one wait at a time per session', async () => {
            const { createRoom, seatKiro, table, scheduler } = createTableFixture();
            const { session } = seatKiro(createRoom());
            const first = table.waitForRound(session, 60);
            expect(await asyncErrorOf(() => table.waitForRound(session, 60))).toEqual({
                code: 'rate_limited',
                retryAfterMs: 1000,
            });
            scheduler.advance(60_000);
            expect((await first).change).toBe('timeout');
            const next = table.waitForRound(session, 1);
            scheduler.advance(1000);
            expect((await next).change).toBe('timeout');
        });
    });
    describe('isolation between sessions', () => {
        it('lets each session act only on its own seat', () => {
            const { createRoom, joinHuman, seatKiro, table, rooms } = createTableFixture();
            const ana = createRoom('Ana');
            const bia = joinHuman(ana.roomCode, 'Bia');
            const a = seatKiro(ana);
            const b = seatKiro(bia);
            table.castVote(a.session, { value: 'PP', rationale: 'a' });
            table.castVote(b.session, { value: 'G', rationale: 'b' });
            expect(table.getRound(a.session).yourVote?.value).toBe('PP');
            expect(table.getRound(b.session).yourVote?.value).toBe('G');
            table.leave(a.session);
            expect(table.getRound(b.session).yourVote?.value).toBe('G');
            expect(rooms.getRoom(ana.roomCode).participants.map(({ name }) => name)).toContain('Kiro do Bia');
        });
    });
});
