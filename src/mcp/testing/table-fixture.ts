import { roomCreatePayloadSchema, roomJoinPayloadSchema, RoomSession } from '../../contracts';
import { RoomRepository } from '../../domain/room.repository';
import { RandomRoomCodeGenerator } from '../../domain/room-code';
import { RoomService } from '../../domain/room.service';
import { FakeClock } from '../../domain/testing/fake-clock';
import { FakeScheduler } from '../../gateway/session/testing/fake-scheduler';
import { KiroSession } from '../kiro-session';
import { KiroTableService } from '../kiro-table.service';
export const createTableFixture = () => {
    const clock = new FakeClock();
    const scheduler = new FakeScheduler(clock);
    const repository = new RoomRepository(clock, new RandomRoomCodeGenerator(), 'server-test');
    const rooms = new RoomService(repository);
    const table = new KiroTableService(rooms, scheduler);
    const createRoom = (participantName = 'Ana', settings: Record<string, unknown> = { allowKiro: true }) =>
        rooms.createRoom(
            roomCreatePayloadSchema.parse({
                roomName: 'Sprint',
                participantName,
                settings,
            }),
        );
    const joinHuman = (roomCode: string, name: string): RoomSession =>
        rooms.join(roomJoinPayloadSchema.parse({ roomCode, name }));
    const seatKiro = (owner: RoomSession) => {
        const session = new KiroSession();
        const { inviteCode } = rooms.createKiroInvite(owner.roomCode, owner.participantId);
        const joined = table.join(session, inviteCode);
        return { session, joined, inviteCode };
    };
    return { clock, scheduler, rooms, table, createRoom, joinHuman, seatKiro };
};
