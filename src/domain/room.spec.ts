import {
    DEFAULT_ROOM_SETTINGS,
    DISCONNECTED_PLAYER_GRACE_MS,
    PARTICIPANT_ID_PATTERN,
    ROOM_IDLE_TTL_MS,
    SECRET_TOKEN_PATTERN,
} from '../contracts';
import { DomainError } from './domain-error';
import { createRoomFixture, TEST_ROOM_CODE } from './testing/room-fixtures';

const errorOf = (action: () => unknown) => {
    try {
        action();
    } catch (error) {
        if (error instanceof DomainError) return error.error;
        throw error;
    }
    throw new Error('Expected a DomainError');
};

describe('Room creation', () => {
    it('makes the creator a connected player and the facilitator', () => {
        const { room, owner } = createRoomFixture();
        const creator = room.requireParticipant(owner.id);
        expect(room.code).toBe(TEST_ROOM_CODE);
        expect(creator).toMatchObject({ name: 'Ana', role: 'player', presence: 'connected' });
        expect(room.facilitatorId).toBe(owner.id);
        expect(owner.id).toMatch(PARTICIPANT_ID_PATTERN);
        expect(owner.token).toMatch(SECRET_TOKEN_PATTERN);
    });

    it('starts in the voting phase of round 1 with the default settings', () => {
        const { room } = createRoomFixture();
        expect(room.phase).toBe('voting');
        expect(room.roundId).toBe(1);
        expect(room.settings).toEqual(DEFAULT_ROOM_SETTINGS);
    });

    it('never mutates the frozen contract constants', () => {
        const before = structuredClone(DEFAULT_ROOM_SETTINGS);
        const { room, owner } = createRoomFixture({ settings: {} });
        room.updateSettings(owner.id, { specialCards: ['?'], autoReveal: true });
        room.settings.deck.cards.push({ value: 'XXL' });
        expect(DEFAULT_ROOM_SETTINGS).toEqual(before);
        expect(Object.isFrozen(DEFAULT_ROOM_SETTINGS)).toBe(true);
        expect(createRoomFixture().room.settings.deck.cards).toHaveLength(4);
    });

    it('does not keep the stored token in plain text', () => {
        const { room, owner } = createRoomFixture();
        expect(JSON.stringify(room.requireParticipant(owner.id))).not.toContain(owner.token);
    });
});

describe('Room joining', () => {
    it('adds players and spectators with their own ids and tokens', () => {
        const { room, join } = createRoomFixture();
        const bia = join('Bia');
        const leo = join('Leo', 'spectator');
        expect(room.requireParticipant(bia.id).role).toBe('player');
        expect(room.requireParticipant(leo.id).role).toBe('spectator');
        expect(new Set([bia.id, leo.id, bia.token, leo.token]).size).toBe(4);
    });

    it('rejects a name already used in the room, ignoring case and surrounding spaces', () => {
        const { join } = createRoomFixture();
        join('Bia');
        expect(errorOf(() => join('bia'))).toMatchObject({ code: 'invalid_payload' });
        expect(errorOf(() => join('ANA'))).toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects spectators when the room does not allow them', () => {
        const { join } = createRoomFixture({ settings: { allowSpectators: false } });
        expect(errorOf(() => join('Leo', 'spectator'))).toEqual({ code: 'spectators_disabled' });
    });
});

describe('Room reconnection with the session token', () => {
    it('keeps the seat, role and vote when the token is right', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia', 'spectator');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.markDisconnected(owner.id);
        const session = room.join({ name: 'Another name', role: 'spectator', sessionToken: owner.token });
        expect(session).toEqual({ participantId: owner.id, sessionToken: owner.token });
        expect(room.requireParticipant(owner.id)).toMatchObject({
            name: 'Ana',
            role: 'player',
            presence: 'connected',
            vote: 'P',
        });
        expect(room.requireParticipant(bia.id).role).toBe('spectator');
    });

    it('rejects a wrong or unknown token without creating a participant', () => {
        const { room, join } = createRoomFixture();
        const bia = join('Bia');
        const count = room.participants.length;
        const wrong = bia.token.replace(/.$/, bia.token.endsWith('A') ? 'B' : 'A');
        expect(errorOf(() => room.join({ name: 'Bia', role: 'player', sessionToken: wrong }))).toEqual({
            code: 'session_token_invalid',
        });
        expect(room.participants).toHaveLength(count);
    });

    it('rejects the token of a participant who left', () => {
        const { room, join } = createRoomFixture();
        const bia = join('Bia');
        room.leave(bia.id);
        expect(errorOf(() => room.join({ name: 'Bia', role: 'player', sessionToken: bia.token }))).toEqual({
            code: 'session_token_invalid',
        });
    });
});

describe('Room presence', () => {
    it('tracks when a participant disconnected and clears it on reconnect', () => {
        const { room, clock, join } = createRoomFixture();
        const bia = join('Bia');
        room.markDisconnected(bia.id);
        expect(room.requireParticipant(bia.id)).toMatchObject({
            presence: 'disconnected',
            disconnectedAt: clock.now(),
        });
        room.markConnected(bia.id);
        expect(room.requireParticipant(bia.id)).toMatchObject({ presence: 'connected', disconnectedAt: null });
    });

    it('throws not_in_room for an unknown participant', () => {
        const { room } = createRoomFixture();
        expect(errorOf(() => room.markDisconnected('ghost'))).toEqual({ code: 'forbidden', reason: 'not_in_room' });
    });

    it('marks the room as empty once no human is connected and clears it when someone returns', () => {
        const { room, clock, owner } = createRoomFixture();
        expect(room.emptiedAt).toBeNull();
        room.markDisconnected(owner.id);
        expect(room.emptiedAt).toBe(clock.now());
        clock.advance(ROOM_IDLE_TTL_MS - 1);
        expect(room.isExpired(clock.now())).toBe(false);
        clock.advance(1);
        expect(room.isExpired(clock.now())).toBe(true);
        room.markConnected(owner.id);
        expect(room.emptiedAt).toBeNull();
        expect(room.isExpired(clock.now())).toBe(false);
    });

    it('counts the grace period for disconnected players as 30 seconds', () => {
        expect(DISCONNECTED_PLAYER_GRACE_MS).toBe(30_000);
    });
});

describe('Room facilitator', () => {
    it('passes to the next connected human when the facilitator leaves', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        const leo = join('Leo', 'spectator');
        room.markDisconnected(bia.id);
        room.leave(owner.id);
        expect(room.facilitatorId).toBe(leo.id);
        expect(room.participants.some((participant) => participant.id === owner.id)).toBe(false);
    });

    it('falls back to a disconnected human and leaves nobody when the room has no humans', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.markDisconnected(bia.id);
        room.markDisconnected(owner.id);
        room.leave(owner.id);
        expect(room.facilitatorId).toBe(bia.id);
        room.leave(bia.id);
        expect(room.facilitatorId).toBeNull();
        expect(room.emptiedAt).not.toBeNull();
    });

    it('lets the facilitator hand over the role to another human only', () => {
        const { room, owner, join } = createRoomFixture({ settings: { allowKiro: true } });
        const bia = join('Bia');
        room.transferFacilitator(owner.id, bia.id);
        expect(room.facilitatorId).toBe(bia.id);
        expect(errorOf(() => room.transferFacilitator(owner.id, owner.id))).toEqual({
            code: 'forbidden',
            reason: 'facilitator_only',
        });
        const invite = room.createKiroInvite(bia.id);
        const kiro = room.redeemKiroInvite(invite.inviteCode);
        expect(errorOf(() => room.transferFacilitator(bia.id, kiro.participantId))).toEqual({
            code: 'invalid_target',
        });
        expect(errorOf(() => room.transferFacilitator(bia.id, 'ghost'))).toEqual({ code: 'invalid_target' });
    });

    it('promotes the first human to join an empty room', () => {
        const { room, owner } = createRoomFixture();
        room.leave(owner.id);
        const session = room.join({ name: 'Bia', role: 'player' });
        expect(room.facilitatorId).toBe(session.participantId);
    });
});

describe('Room roles', () => {
    it('lets a human switch between player and spectator and drops the vote when becoming spectator', () => {
        const { room, owner } = createRoomFixture();
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.setRole(owner.id, 'spectator');
        expect(room.requireParticipant(owner.id)).toMatchObject({ role: 'spectator', vote: null });
        room.setRole(owner.id, 'player');
        expect(room.requireParticipant(owner.id).role).toBe('player');
    });

    it('refuses to become a spectator when spectators are disabled', () => {
        const { room, owner } = createRoomFixture({ settings: { allowSpectators: false } });
        expect(errorOf(() => room.setRole(owner.id, 'spectator'))).toEqual({ code: 'spectators_disabled' });
    });
});

describe('Room settings', () => {
    it('lets only the facilitator update settings', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.updateSettings(owner.id, { countdownSeconds: 5, autoReveal: true });
        expect(room.settings).toMatchObject({ countdownSeconds: 5, autoReveal: true });
        expect(errorOf(() => room.updateSettings(bia.id, { countdownSeconds: 0 }))).toEqual({
            code: 'forbidden',
            reason: 'facilitator_only',
        });
    });

    it('rejects an invalid patch and keeps the old settings', () => {
        const { room, owner } = createRoomFixture();
        expect(errorOf(() => room.updateSettings(owner.id, { countdownSeconds: 4 } as never))).toMatchObject({
            code: 'invalid_payload',
        });
        expect(room.settings.countdownSeconds).toBe(3);
    });

    it('drops votes that no longer exist in the new deck', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.vote(owner.id, { roundId: 1, value: 'P' });
        room.vote(bia.id, { roundId: 1, value: '?' });
        room.updateSettings(owner.id, {
            deck: { presetId: 'fibonacci', cards: ['1', '2', '3', '5', '8', '13', '21'].map((value) => ({ value })) },
            specialCards: [],
        });
        expect(room.requireParticipant(owner.id).vote).toBeNull();
        expect(room.requireParticipant(bia.id).vote).toBeNull();
    });

    it('sets the current issue only through the facilitator', () => {
        const { room, owner, join } = createRoomFixture();
        const bia = join('Bia');
        room.setCurrentIssue(owner.id, { key: 'YAK-1', summary: 'Login' });
        expect(room.currentIssue).toEqual({ key: 'YAK-1', summary: 'Login' });
        expect(errorOf(() => room.setCurrentIssue(bia.id, null))).toEqual({
            code: 'forbidden',
            reason: 'facilitator_only',
        });
        room.setCurrentIssue(owner.id, null);
        expect(room.currentIssue).toBeNull();
    });
});
