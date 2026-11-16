import { NestFactory } from '@nestjs/core';
import { RoomCreatePayload, roomCreatePayloadSchema, roomSessionSchema, roomStateSchema } from '../contracts';
import { DomainError } from './domain-error';
import { DomainModule } from './domain.module';
import { RoomRepository } from './room.repository';
import { RoomService } from './room.service';

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
