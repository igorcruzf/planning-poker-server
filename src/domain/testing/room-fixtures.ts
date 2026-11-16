import { RoomCreatePayload, roomCreatePayloadSchema, RoomSession } from '../../contracts';
import { Room } from '../room';
import { FakeClock } from './fake-clock';

export const TEST_SERVER_INSTANCE_ID = 'server-test';
export const TEST_ROOM_CODE = 'yak-abcd2345';

export interface RoomFixture {
    room: Room;
    clock: FakeClock;
    owner: { id: string; token: string };
    join: (name: string, role?: 'player' | 'spectator') => { id: string; token: string };
}

export const roomPayload = (overrides: Partial<Record<keyof RoomCreatePayload, unknown>> = {}): RoomCreatePayload =>
    roomCreatePayloadSchema.parse({ roomName: 'Sprint', participantName: 'Ana', ...overrides });

export const createRoomFixture = (overrides: Partial<Record<keyof RoomCreatePayload, unknown>> = {}): RoomFixture => {
    const clock = new FakeClock();
    const payload = roomPayload(overrides);
    const room = new Room({ clock, serverInstanceId: TEST_SERVER_INSTANCE_ID }, TEST_ROOM_CODE, payload);
    const session = room.join({ name: payload.participantName, role: 'player' });
    const join = (name: string, role: 'player' | 'spectator' = 'player') => {
        const joined: Pick<RoomSession, 'participantId' | 'sessionToken'> = room.join({ name, role });
        return { id: joined.participantId, token: joined.sessionToken };
    };
    return { room, clock, owner: { id: session.participantId, token: session.sessionToken }, join };
};
