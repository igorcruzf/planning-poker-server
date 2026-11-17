import { Injectable } from '@nestjs/common';
import { DomainError } from '../../domain/domain-error';
import { RoomService } from '../../domain/room.service';
import { ParticipantSession, SocketSessionRegistry } from './socket-session-registry';

@Injectable()
export class ParticipantPresence {
    constructor(
        private readonly rooms: RoomService,
        private readonly sessions: SocketSessionRegistry,
    ) {}

    releaseSeat(session: ParticipantSession): void {
        if (this.sessions.isConnected(session)) return;
        try {
            this.rooms.disconnect(session.roomCode, session.participantId);
        } catch (error) {
            if (!(error instanceof DomainError)) throw error;
        }
    }
}
