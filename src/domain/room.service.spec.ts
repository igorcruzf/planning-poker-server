import { NestFactory } from '@nestjs/core';
import { RoomCreatePayload, roomCreatePayloadSchema, roomSessionSchema, roomStateSchema } from '../contracts';
import { DomainError } from './domain-error';
import { DomainModule } from './domain.module';
import { DISCONNECTED_PARTICIPANT_TTL_MS } from './room';
import { RoomRepository } from './room.repository';
import { RoomChange, RoomService } from './room.service';

const createPayload = (overrides: Partial<RoomCreatePayload> = {}): RoomCreatePayload =>
    roomCreatePayloadSchema.parse({ roomName: 'Sprint', participantName: 'Ana', ...overrides });

const errorOf = (action: () => unknown) => {
    try {
        action();
    } catch (error) {
        if (error instanceof DomainError) return error.error;
        throw error;
    }
    throw new Error('Expected a DomainError');
};

describe('DomainModule', () => {
    it('exports the repository and the service with working dependencies', async () => {
        const context = await NestFactory.createApplicationContext(DomainModule, { logger: false });
        try {
            expect(context.get(RoomRepository)).toBeInstanceOf(RoomRepository);
            const service = context.get(RoomService);
            const session = service.createRoom(createPayload());
            expect(roomSessionSchema.safeParse(session).success).toBe(true);
            expect(roomStateSchema.safeParse(service.snapshot(session.roomCode, session.participantId)).success).toBe(
                true,
            );
        } finally {
            await context.close();
        }
    });
});

describe('RoomService change notification', () => {
    let context: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
    let service: RoomService;
    let changes: RoomChange[];

    beforeEach(async () => {
        context = await NestFactory.createApplicationContext(DomainModule, { logger: false });
        service = context.get(RoomService);
        changes = [];
    });

    afterEach(() => context.close());

    const kiroRoom = () =>
        service.createRoom(createPayload({ settings: { ...createPayload().settings, allowKiro: true, countdownSeconds: 0 } }));

    it('notifies the room code and the reason after each successful mutation', () => {
        const owner = kiroRoom();
        service.onChange((change) => changes.push(change));
        const bia = service.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        service.vote(owner.roomCode, owner.participantId, { roundId: 1, value: 'P' });
        service.disconnect(owner.roomCode, bia.participantId);
        expect(changes).toEqual([
            { roomCode: owner.roomCode, reason: 'joined' },
            { roomCode: owner.roomCode, reason: 'voted' },
            { roomCode: owner.roomCode, reason: 'disconnected' },
        ]);
    });

    it('notifies the Kiro mutations: invite, seat, vote and leave', () => {
        const owner = kiroRoom();
        service.onChange((change) => changes.push(change));
        const seat = service.redeemKiroInvite(service.createKiroInvite(owner.roomCode, owner.participantId).inviteCode);
        service.castKiroVote(seat.roomCode, seat.participantId, { value: 'M', rationale: 'Parece médio' });
        service.leave(seat.roomCode, seat.participantId);
        expect(changes.map((change) => change.reason)).toEqual([
            'kiro_invite_created',
            'kiro_seated',
            'kiro_voted',
            'left',
        ]);
    });

    it('does not notify when the mutation fails', () => {
        const owner = kiroRoom();
        service.onChange((change) => changes.push(change));
        expect(() => service.vote(owner.roomCode, owner.participantId, { roundId: 1, value: 'XL' })).toThrow(DomainError);
        expect(() => service.join({ roomCode: owner.roomCode, name: 'Kiro do Ana', role: 'player' })).toThrow(DomainError);
        expect(changes).toEqual([]);
    });

    it('stops notifying after the returned cancel function runs and isolates a failing listener', () => {
        const owner = kiroRoom();
        const failing = jest.fn(() => {
            throw new Error('listener failure');
        });
        service.onChange(failing);
        const cancel = service.onChange((change) => changes.push(change));
        service.setCurrentIssue(owner.roomCode, owner.participantId, { key: 'YAK-1', summary: 'Card' });
        cancel();
        service.setCurrentIssue(owner.roomCode, owner.participantId, null);
        expect(changes).toEqual([{ roomCode: owner.roomCode, reason: 'issue_changed' }]);
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('notifies the countdown end only when the phase really changes', () => {
        const owner = service.createRoom(createPayload({ settings: { ...createPayload().settings, countdownSeconds: 3 } }));
        service.vote(owner.roomCode, owner.participantId, { roundId: 1, value: 'P' });
        service.reveal(owner.roomCode, owner.participantId, { roundId: 1, confirmMissingVotes: false });
        service.onChange((change) => changes.push(change));
        service.finishCountdown(owner.roomCode, 99);
        service.finishCountdown(owner.roomCode, 1);
        service.finishCountdown(owner.roomCode, 1);
        expect(changes).toEqual([{ roomCode: owner.roomCode, reason: 'countdown_finished' }]);
    });

    it('does not notify mutations that changed nothing', () => {
        const owner = kiroRoom();
        const bia = service.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        service.disconnect(owner.roomCode, bia.participantId);
        service.onChange((change) => changes.push(change));
        service.disconnect(owner.roomCode, bia.participantId);
        service.setRole(owner.roomCode, owner.participantId, 'player');
        service.updateSettings(owner.roomCode, owner.participantId, { autoReveal: false });
        service.settle(owner.roomCode);
        expect(changes).toEqual([]);
    });

    it('notifies the mutations that did change something', () => {
        const owner = kiroRoom();
        service.onChange((change) => changes.push(change));
        service.setRole(owner.roomCode, owner.participantId, 'spectator');
        service.updateSettings(owner.roomCode, owner.participantId, { autoReveal: true });
        expect(changes.map((change) => change.reason)).toEqual(['role_changed', 'settings_updated']);
    });

    it('notifies a repeated disconnect only once', () => {
        const owner = kiroRoom();
        service.onChange((change) => changes.push(change));
        service.disconnect(owner.roomCode, owner.participantId);
        service.disconnect(owner.roomCode, owner.participantId);
        service.connect(owner.roomCode, owner.participantId);
        expect(changes.map((change) => change.reason)).toEqual(['disconnected', 'connected']);
    });

    it('settles the auto reveal when the presence deadline passes and reports the next deadline', () => {
        const owner = service.createRoom(
            createPayload({ settings: { ...createPayload().settings, autoReveal: true, countdownSeconds: 0 } }),
        );
        const bia = service.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        service.vote(owner.roomCode, owner.participantId, { roundId: 1, value: 'P' });
        service.disconnect(owner.roomCode, bia.participantId);
        const deadline = service.nextPresenceDeadline(owner.roomCode)!;
        expect(deadline).toBeGreaterThan(Date.now());
        service.onChange((change) => changes.push(change));
        jest.spyOn(Date, 'now').mockReturnValue(deadline);
        expect(service.settle(owner.roomCode)).toEqual({ phase: 'revealed' });
        expect(changes).toEqual([{ roomCode: owner.roomCode, reason: 'settled' }]);
        expect(service.nextPresenceDeadline(owner.roomCode)).toBeNull();
        jest.restoreAllMocks();
    });

    it('notifies the settle when the grace period drops a pending voter without the auto reveal', () => {
        const owner = service.createRoom(createPayload({ settings: { ...createPayload().settings, autoReveal: false } }));
        const bia = service.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        const caio = service.join({ roomCode: owner.roomCode, name: 'Caio', role: 'player' });
        service.vote(owner.roomCode, owner.participantId, { roundId: 1, value: 'P' });
        service.vote(owner.roomCode, bia.participantId, { roundId: 1, value: 'M' });
        service.disconnect(owner.roomCode, caio.participantId);
        const deadline = service.nextPresenceDeadline(owner.roomCode)!;
        expect(deadline).toBeGreaterThan(Date.now());
        service.onChange((change) => changes.push(change));
        jest.spyOn(Date, 'now').mockReturnValue(deadline);
        expect(service.settle(owner.roomCode)).toEqual({ phase: 'voting' });
        service.settle(owner.roomCode);
        expect(changes).toEqual([{ roomCode: owner.roomCode, reason: 'settled' }]);
        expect(service.snapshot(owner.roomCode, bia.participantId)).toMatchObject({ round: { pendingVoterIds: [] } });
        expect(service.nextPresenceDeadline(owner.roomCode)).toBeNull();
        jest.restoreAllMocks();
    });

    it('does not leave an orphan room behind when the creator name is refused', () => {
        const repository = context.get(RoomRepository);
        expect(() => service.createRoom(createPayload({ participantName: 'Kiro do Ana' }))).toThrow(DomainError);
        expect(repository.size).toBe(0);
    });
});

describe('RoomService', () => {
    let context: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
    let service: RoomService;

    beforeEach(async () => {
        context = await NestFactory.createApplicationContext(DomainModule, { logger: false });
        service = context.get(RoomService);
    });

    afterEach(() => context.close());

    it('plays a full round: create, join, vote, reveal, finish countdown and new hand', () => {
        const owner = service.createRoom(createPayload({ settings: { ...createPayload().settings, countdownSeconds: 0 } }));
        const bia = service.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        service.vote(owner.roomCode, owner.participantId, { roundId: 1, value: 'P' });
        service.vote(owner.roomCode, bia.participantId, { roundId: 1, value: 'M' });
        expect(
            service.reveal(owner.roomCode, bia.participantId, { roundId: 1, confirmMissingVotes: false }),
        ).toEqual({ phase: 'revealed' });
        const state = service.snapshot(owner.roomCode, bia.participantId);
        expect(state.round).toMatchObject({ phase: 'revealed', votes: [{ value: 'P' }, { value: 'M' }] });
        service.reset(owner.roomCode, owner.participantId, { roundId: 1 });
        expect(service.snapshot(owner.roomCode, bia.participantId).round).toMatchObject({ id: 2, phase: 'voting' });
    });

    it('answers room_not_found for an unknown code', () => {
        expect(errorOf(() => service.join({ roomCode: 'yak-unknown1', name: 'Bia', role: 'player' }))).toMatchObject({
            code: 'room_not_found',
        });
        expect(errorOf(() => service.snapshot('yak-unknown1', null))).toMatchObject({ code: 'room_not_found' });
    });

    it('reconnects with the session token and rejects a wrong one', () => {
        const owner = service.createRoom(createPayload());
        service.disconnect(owner.roomCode, owner.participantId);
        const again = service.join({
            roomCode: owner.roomCode,
            name: 'Ana',
            role: 'player',
            sessionToken: owner.sessionToken,
        });
        expect(again.participantId).toBe(owner.participantId);
        const wrong = owner.sessionToken.replace(/.$/, owner.sessionToken.endsWith('A') ? 'B' : 'A');
        expect(
            errorOf(() => service.join({ roomCode: owner.roomCode, name: 'Ana', role: 'player', sessionToken: wrong })),
        ).toEqual({ code: 'session_token_invalid' });
    });

    it('runs the Kiro flow from invite to vote and leave', () => {
        const owner = service.createRoom(createPayload({ settings: { ...createPayload().settings, allowKiro: true } }));
        const invite = service.createKiroInvite(owner.roomCode, owner.participantId);
        const seat = service.redeemKiroInvite(invite.inviteCode);
        expect(seat).toMatchObject({ roomCode: owner.roomCode, roomName: 'Sprint', seatName: 'Kiro do Ana' });
        service.castKiroVote(seat.roomCode, seat.participantId, { value: 'M', rationale: 'Parece médio' });
        expect(service.snapshot(owner.roomCode, owner.participantId).participants).toHaveLength(2);
        service.leave(seat.roomCode, seat.participantId);
        expect(service.snapshot(owner.roomCode, owner.participantId).participants).toHaveLength(1);
        expect(errorOf(() => service.redeemKiroInvite(invite.inviteCode))).toEqual({ code: 'invite_invalid' });
    });
});

describe('RoomService umbrella and authentication', () => {
    let context: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
    let service: RoomService;
    let changes: RoomChange[];

    beforeEach(async () => {
        context = await NestFactory.createApplicationContext(DomainModule, { logger: false });
        service = context.get(RoomService);
        changes = [];
    });

    afterEach(() => context.close());

    it('reflects the umbrella in the snapshot and notifies only when it changed', () => {
        const owner = service.createRoom(createPayload());
        service.onChange((change) => changes.push(change));

        service.setUmbrella(owner.roomCode, owner.participantId, true);
        service.setUmbrella(owner.roomCode, owner.participantId, true);

        expect(service.snapshot(owner.roomCode, owner.participantId).participants[0].umbrella).toBe(true);
        expect(changes).toEqual([{ roomCode: owner.roomCode, reason: 'umbrella_changed' }]);
    });

    it('authenticates a session token without notifying or touching presence', () => {
        const owner = service.createRoom(createPayload());
        service.disconnect(owner.roomCode, owner.participantId);
        service.onChange((change) => changes.push(change));

        const view = service.authenticate(owner.roomCode, owner.sessionToken);

        expect(view.id).toBe(owner.participantId);
        expect(view.presence).toBe('disconnected');
        expect(changes).toEqual([]);
    });

    it('refuses a wrong token and an unknown room', () => {
        const owner = service.createRoom(createPayload());

        expect(errorOf(() => service.authenticate(owner.roomCode, 'wrong'))).toEqual({ code: 'session_token_invalid' });
        expect(errorOf(() => service.authenticate('yak-zzzzzzzz', owner.sessionToken))).toMatchObject({
            code: 'room_not_found',
        });
    });
    it('notifies a left change when the sweep prunes absent participants', () => {
        const owner = service.createRoom(createPayload());
        const bia = service.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        service.disconnect(owner.roomCode, bia.participantId);
        service.onChange((change) => changes.push(change));
        context.get(RoomRepository).sweep(Date.now() + DISCONNECTED_PARTICIPANT_TTL_MS + 1000);
        expect(changes).toEqual([{ roomCode: owner.roomCode, reason: 'left' }]);
    });
});
