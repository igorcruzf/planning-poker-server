import { DomainError } from '../../domain/domain-error';
import { SocketSessionRegistry } from './socket-session-registry';

const ana = { roomCode: 'yak-aaaa2345', participantId: 'p-ana' };
const bia = { roomCode: 'yak-aaaa2345', participantId: 'p-bia' };
const otherRoom = { roomCode: 'yak-bbbb2345', participantId: 'p-caio' };

describe('SocketSessionRegistry', () => {
    let registry: SocketSessionRegistry;

    beforeEach(() => {
        registry = new SocketSessionRegistry();
    });

    it('finds the seat bound to a socket', () => {
        registry.bind('s1', ana);
        expect(registry.find('s1')).toEqual(ana);
        expect(registry.find('s2')).toBeUndefined();
    });

    it('refuses an unbound socket with forbidden not_in_room', () => {
        expect(() => registry.require('s1')).toThrow(DomainError);
        try {
            registry.require('s1');
        } catch (error) {
            expect((error as DomainError).error).toEqual({ code: 'forbidden', reason: 'not_in_room' });
        }
    });

    it('returns the previous seat when a socket is bound again', () => {
        registry.bind('s1', ana);
        expect(registry.bind('s1', otherRoom)).toEqual(ana);
        expect(registry.socketsOf(ana.roomCode)).toEqual([]);
        expect(registry.socketsOf(otherRoom.roomCode)).toEqual([{ socketId: 's1', participantId: 'p-caio' }]);
    });

    it('lists the sockets of a room with their participant', () => {
        registry.bind('s1', ana);
        registry.bind('s2', bia);
        registry.bind('s3', otherRoom);
        expect(registry.socketsOf(ana.roomCode)).toEqual([
            { socketId: 's1', participantId: 'p-ana' },
            { socketId: 's2', participantId: 'p-bia' },
        ]);
    });

    it('unbinds a socket and tells which seat it had', () => {
        registry.bind('s1', ana);
        expect(registry.unbind('s1')).toEqual(ana);
        expect(registry.unbind('s1')).toBeUndefined();
        expect(registry.socketsOf(ana.roomCode)).toEqual([]);
    });

    it('knows when a participant still has another socket', () => {
        registry.bind('s1', ana);
        registry.bind('s2', ana);
        registry.unbind('s1');
        expect(registry.isConnected(ana)).toBe(true);
        registry.unbind('s2');
        expect(registry.isConnected(ana)).toBe(false);
    });

    it('unbinds every socket of a participant', () => {
        registry.bind('s1', ana);
        registry.bind('s2', ana);
        registry.bind('s3', bia);
        expect(registry.unbindParticipant(ana).sort()).toEqual(['s1', 's2']);
        expect(registry.find('s1')).toBeUndefined();
        expect(registry.find('s3')).toEqual(bia);
    });

    it('does not mix participants with the same id in different rooms', () => {
        registry.bind('s1', { roomCode: 'yak-aaaa2345', participantId: 'p-1' });
        expect(registry.isConnected({ roomCode: 'yak-bbbb2345', participantId: 'p-1' })).toBe(false);
    });
});
