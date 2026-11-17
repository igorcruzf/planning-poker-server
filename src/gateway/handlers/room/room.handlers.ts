import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { RoomSession } from '../../../contracts';
import { RoomService } from '../../../domain/room.service';
import { GatewayContributor, GatewayRegistry } from '../../gateway-registry';
import { ClientEventRunner } from '../../session/client-event-runner';
import { ParticipantPresence } from '../../session/participant-presence';
import { RoomBroadcaster } from '../../session/room-broadcaster';
import { SocketSessionRegistry } from '../../session/socket-session-registry';

@Injectable()
export class RoomHandlers implements GatewayContributor {
    constructor(
        private readonly rooms: RoomService,
        private readonly sessions: SocketSessionRegistry,
        private readonly runner: ClientEventRunner,
        private readonly broadcaster: RoomBroadcaster,
        private readonly presence: ParticipantPresence,
    ) {}

    register(registry: GatewayRegistry): void {
        registry.on('room:create', (payload, { socket }) =>
            this.runner.run('room:create', payload, socket, (input) => this.seat(socket, this.rooms.createRoom(input))),
        );
        registry.on('room:join', (payload, { socket }) =>
            this.runner.run('room:join', payload, socket, (input) => this.seat(socket, this.rooms.join(input))),
        );
        registry.on('room:leave', (payload, { socket }) =>
            this.runner.run('room:leave', payload, socket, () => {
                const session = this.sessions.require(socket.id);
                this.rooms.leave(session.roomCode, session.participantId);
                this.sessions.unbindParticipant(session);
                return null;
            }),
        );
        registry.on('room:updateSettings', (payload, { socket }) =>
            this.runner.run('room:updateSettings', payload, socket, (patch) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.updateSettings(roomCode, participantId, patch);
                return null;
            }),
        );
        registry.on('room:transferFacilitator', (payload, { socket }) =>
            this.runner.run('room:transferFacilitator', payload, socket, ({ participantId: targetId }) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.transferFacilitator(roomCode, participantId, targetId);
                return null;
            }),
        );
        registry.on('room:setRole', (payload, { socket }) =>
            this.runner.run('room:setRole', payload, socket, ({ role }) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.setRole(roomCode, participantId, role);
                return null;
            }),
        );
    }

    private seat(socket: Socket, session: RoomSession): RoomSession {
        const previous = this.sessions.bind(socket.id, session);
        if (previous) this.presence.releaseSeat(previous);
        this.broadcaster.sendTo(socket.id);
        return session;
    }
}
