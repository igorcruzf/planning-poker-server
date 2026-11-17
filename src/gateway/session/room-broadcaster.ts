import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { RoomService } from '../../domain/room.service';
import { describeError } from '../describe-error';
import { SeatedSocket, SocketSessionRegistry } from './socket-session-registry';

@Injectable()
export class RoomBroadcaster {
    private readonly logger = new Logger(RoomBroadcaster.name);
    private server: Server | undefined;

    constructor(
        private readonly rooms: RoomService,
        private readonly sessions: SocketSessionRegistry,
    ) {}

    attach(server: Server): void {
        this.server = server;
    }

    broadcast(roomCode: string): void {
        this.sessions.socketsOf(roomCode).forEach((seated) => this.sendState(roomCode, seated));
    }

    sendTo(socketId: string): void {
        const session = this.sessions.find(socketId);
        if (session) this.sendState(session.roomCode, { socketId, participantId: session.participantId });
    }

    private sendState(roomCode: string, { socketId, participantId }: SeatedSocket): void {
        try {
            if (!this.rooms.getRoom(roomCode).findParticipant(participantId)) return;
            this.server?.to(socketId).emit('room:state', this.rooms.snapshot(roomCode, participantId));
        } catch (error) {
            this.logger.error(`Could not send room:state to client ${socketId}: ${describeError(error)}`);
        }
    }
}
