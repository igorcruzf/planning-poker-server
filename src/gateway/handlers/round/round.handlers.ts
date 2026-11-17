import { Injectable } from '@nestjs/common';
import { RoomService } from '../../../domain/room.service';
import { GatewayContributor, GatewayRegistry } from '../../gateway-registry';
import { ClientEventRunner } from '../../session/client-event-runner';
import { SocketSessionRegistry } from '../../session/socket-session-registry';

@Injectable()
export class RoundHandlers implements GatewayContributor {
    constructor(
        private readonly rooms: RoomService,
        private readonly sessions: SocketSessionRegistry,
        private readonly runner: ClientEventRunner,
    ) {}

    register(registry: GatewayRegistry): void {
        registry.on('round:vote', (payload, { socket }) =>
            this.runner.run('round:vote', payload, socket, (request) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.vote(roomCode, participantId, request);
                return null;
            }),
        );
        registry.on('round:reveal', (payload, { socket }) =>
            this.runner.run('round:reveal', payload, socket, (request) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.reveal(roomCode, participantId, request);
                return null;
            }),
        );
        registry.on('round:reset', (payload, { socket }) =>
            this.runner.run('round:reset', payload, socket, (request) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.reset(roomCode, participantId, request);
                return null;
            }),
        );
        registry.on('round:finalize', (payload, { socket }) =>
            this.runner.run('round:finalize', payload, socket, (request) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.finalize(roomCode, participantId, request);
                return null;
            }),
        );
    }
}
