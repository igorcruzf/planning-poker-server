import { ROOM_IDLE_TTL_MS } from '../contracts';
import { DISCONNECTED_PARTICIPANT_TTL_MS } from './room';
import { DomainError } from './domain-error';
import { RoomCodeGenerator } from './room-code';
import { RoomRepository, SWEEP_INTERVAL_MS } from './room.repository';
import { FakeClock } from './testing/fake-clock';
import { roomPayload, TEST_SERVER_INSTANCE_ID } from './testing/room-fixtures';

class ScriptedCodes extends RoomCodeGenerator {
    constructor(private readonly codes: string[]) {
        super();
    }

    generate(): string {
        return this.codes.shift() ?? 'yak-zzzzzzzz';
    }
}

const createRepository = (codes: string[] = []) => {
    const clock = new FakeClock();
    const repository = new RoomRepository(clock, new ScriptedCodes(codes), TEST_SERVER_INSTANCE_ID);
    return { clock, repository };
};

describe('RoomRepository', () => {
    it('creates rooms with a unique code, skipping codes already in use', () => {
        const { repository } = createRepository(['yak-aaaaaaaa', 'yak-aaaaaaaa', 'yak-bbbbbbbb']);
        const first = repository.create(roomPayload());
        const second = repository.create(roomPayload());
        expect(first.code).toBe('yak-aaaaaaaa');
        expect(second.code).toBe('yak-bbbbbbbb');
        expect(repository.size).toBe(2);
    });

    it('gives up with an internal error when it cannot find a free code', () => {
        const { repository } = createRepository();
        repository.create(roomPayload());
        expect(() => repository.create(roomPayload())).toThrow(DomainError);
    });

    it('finds rooms by code, ignoring case and spaces', () => {
        const { repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload());
        expect(repository.find('  YAK-AAAAAAAA ')).toBe(room);
        expect(repository.find('yak-unknown1')).toBeUndefined();
    });

    it('throws room_not_found with the server instance id', () => {
        const { repository } = createRepository();
        try {
            repository.require('yak-unknown1');
            throw new Error('expected a failure');
        } catch (error) {
            expect((error as DomainError).error).toEqual({
                code: 'room_not_found',
                serverInstanceId: TEST_SERVER_INSTANCE_ID,
            });
        }
    });

    it('removes a room that stayed empty for 2 hours and keeps one that is still occupied', () => {
        const { clock, repository } = createRepository(['yak-aaaaaaaa', 'yak-bbbbbbbb']);
        const empty = repository.create(roomPayload());
        const occupied = repository.create(roomPayload());
        const emptyOwner = empty.join({ name: 'Ana', role: 'player' });
        occupied.join({ name: 'Bia', role: 'player' });
        empty.markDisconnected(emptyOwner.participantId);
        clock.advance(ROOM_IDLE_TTL_MS - 1);
        repository.sweep(clock.now());
        expect(repository.size).toBe(2);
        clock.advance(1);
        repository.sweep(clock.now());
        expect(repository.find(empty.code)).toBeUndefined();
        expect(repository.find(occupied.code)).toBe(occupied);
    });

    it('keeps a room whose owner came back before the TTL', () => {
        const { clock, repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload());
        const owner = room.join({ name: 'Ana', role: 'player' });
        room.markDisconnected(owner.participantId);
        clock.advance(ROOM_IDLE_TTL_MS - 1);
        room.markConnected(owner.participantId);
        clock.advance(ROOM_IDLE_TTL_MS);
        repository.sweep(clock.now());
        expect(repository.find(room.code)).toBe(room);
    });

    it('treats a room past its TTL as missing before the next sweep, even for a valid token', () => {
        const { clock, repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload());
        const owner = room.join({ name: 'Ana', role: 'player' });
        room.markDisconnected(owner.participantId);
        clock.advance(ROOM_IDLE_TTL_MS);
        expect(repository.find(room.code)).toBeUndefined();
        expect(repository.size).toBe(0);
        expect(() => repository.require(room.code)).toThrow(DomainError);
    });

    it('does not find a Kiro invite in a room past its TTL', () => {
        const { clock, repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload({ settings: { allowKiro: true } }));
        const owner = room.join({ name: 'Ana', role: 'player' });
        const invite = room.createKiroInvite(owner.participantId);
        room.markDisconnected(owner.participantId);
        clock.advance(ROOM_IDLE_TTL_MS);
        expect(repository.findByKiroInvite(invite.inviteCode)).toBeUndefined();
    });

    it('discards a room by code', () => {
        const { repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload());
        repository.discard(room.code);
        expect(repository.size).toBe(0);
    });

    it('finds the room that holds a Kiro invite', () => {
        const { repository } = createRepository(['yak-aaaaaaaa', 'yak-bbbbbbbb']);
        const plain = repository.create(roomPayload());
        const kiro = repository.create(roomPayload({ settings: { allowKiro: true } }));
        const owner = kiro.join({ name: 'Ana', role: 'player' });
        const invite = kiro.createKiroInvite(owner.participantId);
        expect(repository.findByKiroInvite(invite.inviteCode)).toBe(kiro);
        expect(repository.findByKiroInvite('z'.repeat(43))).toBeUndefined();
        expect(plain).toBeDefined();
    });
});

describe('RoomRepository pruning absent participants', () => {
    it('removes humans absent for too long on sweep and announces the room', () => {
        const { clock, repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload());
        const owner = room.join({ name: 'Ana', role: 'player' });
        const bia = room.join({ name: 'Bia', role: 'player' });
        const pruned: string[] = [];
        repository.onPruned((code) => pruned.push(code));
        room.markDisconnected(bia.participantId);
        clock.advance(DISCONNECTED_PARTICIPANT_TTL_MS + 1);
        repository.sweep(clock.now());
        expect(room.participants.map((participant) => participant.id)).toEqual([owner.participantId]);
        expect(pruned).toEqual(['yak-aaaaaaaa']);
        repository.sweep(clock.now());
        expect(pruned).toHaveLength(1);
    });
});
describe('RoomRepository sweeping lifecycle', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sweeps on an interval after init and stops on destroy', () => {
        const { clock, repository } = createRepository(['yak-aaaaaaaa']);
        const room = repository.create(roomPayload());
        const owner = room.join({ name: 'Ana', role: 'player' });
        room.markDisconnected(owner.participantId);
        clock.advance(ROOM_IDLE_TTL_MS);
        repository.onModuleInit();
        jest.advanceTimersByTime(SWEEP_INTERVAL_MS);
        expect(repository.size).toBe(0);
        repository.onModuleDestroy();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not start a second interval when initialised twice', () => {
        const { repository } = createRepository();
        repository.onModuleInit();
        repository.onModuleInit();
        expect(jest.getTimerCount()).toBe(1);
        repository.onModuleDestroy();
    });
});
