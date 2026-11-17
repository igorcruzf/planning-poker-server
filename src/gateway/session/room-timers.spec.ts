import { roomCreatePayloadSchema } from '../../contracts';
import { FakeClock } from '../../domain/testing/fake-clock';
import { RandomRoomCodeGenerator } from '../../domain/room-code';
import { RoomRepository } from '../../domain/room.repository';
import { RoomService } from '../../domain/room.service';
import { RoomTimers } from './room-timers';
import { FakeScheduler } from './testing/fake-scheduler';

const createPayload = (settings: Record<string, unknown>) =>
    roomCreatePayloadSchema.parse({ roomName: 'Sprint', participantName: 'Ana', settings });

describe('RoomTimers', () => {
    let clock: FakeClock;
    let scheduler: FakeScheduler;
    let repository: RoomRepository;
    let rooms: RoomService;
    let timers: RoomTimers;

    beforeEach(() => {
        clock = new FakeClock();
        scheduler = new FakeScheduler(clock);
        repository = new RoomRepository(clock, new RandomRoomCodeGenerator(), 'server-test');
        rooms = new RoomService(repository);
        timers = new RoomTimers(rooms, scheduler, clock);
        rooms.onChange(({ roomCode }) => timers.sync(roomCode));
    });

    const seatTwoPlayers = (settings: Record<string, unknown>) => {
        const ana = rooms.createRoom(createPayload(settings));
        const bia = rooms.join({ roomCode: ana.roomCode, name: 'Bia', role: 'player' });
        return { code: ana.roomCode, ana: ana.participantId, bia: bia.participantId };
    };
    const phaseOf = (code: string) => rooms.getRoom(code).phase;

    it('settles the room when the 30 s grace of a missing voter ends', () => {
        const { code, ana, bia } = seatTwoPlayers({ autoReveal: true, countdownSeconds: 0 });
        rooms.vote(code, ana, { roundId: 1, value: 'M' });
        rooms.disconnect(code, bia);
        scheduler.advance(29_999);
        expect(phaseOf(code)).toBe('voting');
        scheduler.advance(1);
        expect(phaseOf(code)).toBe('revealed');
    });

    it('cancels the presence timer when the voter reconnects', () => {
        const { code, bia } = seatTwoPlayers({ autoReveal: true });
        rooms.disconnect(code, bia);
        expect(scheduler.pendingCount).toBe(1);
        rooms.connect(code, bia);
        expect(scheduler.pendingCount).toBe(0);
    });

    it('does not schedule a presence timer when auto reveal is off', () => {
        const { code, bia } = seatTwoPlayers({ autoReveal: false });
        rooms.disconnect(code, bia);
        expect(scheduler.pendingCount).toBe(0);
    });

    it('finishes the countdown after countdownMs', () => {
        const { code, ana, bia } = seatTwoPlayers({ countdownSeconds: 3 });
        rooms.vote(code, ana, { roundId: 1, value: 'M' });
        rooms.vote(code, bia, { roundId: 1, value: 'P' });
        rooms.reveal(code, ana, { roundId: 1, confirmMissingVotes: false });
        expect(phaseOf(code)).toBe('countdown');
        scheduler.advance(2_999);
        expect(phaseOf(code)).toBe('countdown');
        scheduler.advance(1);
        expect(phaseOf(code)).toBe('revealed');
        expect(scheduler.pendingCount).toBe(0);
    });

    it('schedules the countdown that auto reveal starts', () => {
        const { code, ana, bia } = seatTwoPlayers({ autoReveal: true, countdownSeconds: 5 });
        rooms.vote(code, ana, { roundId: 1, value: 'M' });
        rooms.vote(code, bia, { roundId: 1, value: 'P' });
        expect(phaseOf(code)).toBe('countdown');
        scheduler.advance(5_000);
        expect(phaseOf(code)).toBe('revealed');
    });

    it('cancels the countdown when the round is reset', () => {
        const { code, ana, bia } = seatTwoPlayers({ countdownSeconds: 3 });
        rooms.vote(code, ana, { roundId: 1, value: 'M' });
        rooms.vote(code, bia, { roundId: 1, value: 'P' });
        rooms.reveal(code, ana, { roundId: 1, confirmMissingVotes: false });
        rooms.reset(code, ana, { roundId: 1 });
        expect(scheduler.pendingCount).toBe(0);
        scheduler.advance(3_000);
        expect(phaseOf(code)).toBe('voting');
    });

    it('drops the timers when the room disappears', () => {
        const { code, ana, bia } = seatTwoPlayers({ autoReveal: true });
        rooms.vote(code, ana, { roundId: 1, value: 'M' });
        rooms.disconnect(code, bia);
        repository.discard(code);
        timers.sync(code);
        expect(scheduler.pendingCount).toBe(0);
    });

    it('cancels every timer when the module is destroyed', () => {
        const { code, bia } = seatTwoPlayers({ autoReveal: true });
        rooms.disconnect(code, bia);
        timers.onModuleDestroy();
        expect(scheduler.pendingCount).toBe(0);
    });
});
