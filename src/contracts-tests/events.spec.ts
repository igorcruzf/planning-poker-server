import { Server } from 'socket.io';
import {
    ackSchema,
    CLIENT_EVENTS,
    type ClientToServerEvents,
    EVENT_AREAS,
    SERVER_EVENTS,
    type ServerToClientEvents,
} from '../contracts';

const ALL_EVENT_NAMES = [...Object.keys(CLIENT_EVENTS), ...Object.keys(SERVER_EVENTS)];

describe('event registry', () => {
    it('uses only the handler areas', () => {
        expect(EVENT_AREAS).toEqual(['room', 'round', 'roulette', 'fun', 'jira', 'kiro']);
        ALL_EVENT_NAMES.forEach((name) => expect(EVENT_AREAS).toContain(name.split(':')[0]));
    });

    it.each(ALL_EVENT_NAMES)('names %s as <area>:<action>', (name) => {
        expect(name).toMatch(/^[a-z]+:[a-z][A-Za-z]*$/);
    });

    it('keeps the names fixed by the plan', () => {
        ['room:create', 'room:join', 'fun:throw', 'roulette:spin'].forEach((name) =>
            expect(Object.keys(CLIENT_EVENTS)).toContain(name),
        );
        ['room:state', 'fun:thrown', 'roulette:spun'].forEach((name) =>
            expect(Object.keys(SERVER_EVENTS)).toContain(name),
        );
    });

    it('leaves the legacy events out', () => {
        ['login', 'update', 'reveal', 'start', 'startReveal', 'logout'].forEach((legacy) =>
            expect(ALL_EVENT_NAMES).not.toContain(legacy),
        );
    });

    it('acks void actions with null data', () => {
        expect(ackSchema(CLIENT_EVENTS['round:vote'].result).parse({ ok: true, data: null })).toEqual({
            ok: true,
            data: null,
        });
    });

    it('types a Socket.IO server with the event maps', () => {
        const server = new Server<ClientToServerEvents, ServerToClientEvents>();
        server.on('connection', (socket) => {
            socket.on('round:vote', (_payload, ack) => ack({ ok: true, data: null }));
            socket.on('room:join', (_payload, ack) =>
                ack({ ok: false, error: { code: 'room_not_found', serverInstanceId: 'srv-boot-2' } }),
            );
        });

        expect(server.listeners('connection')).toHaveLength(1);
    });
});
