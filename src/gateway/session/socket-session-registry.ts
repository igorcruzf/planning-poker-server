import { Injectable } from '@nestjs/common';
import { domainErrors } from '../../domain/domain-error';

export interface ParticipantSession {
    readonly roomCode: string;
    readonly participantId: string;
}

export interface SeatedSocket {
    readonly socketId: string;
    readonly participantId: string;
}

@Injectable()
export class SocketSessionRegistry {
    private readonly sessions = new Map<string, ParticipantSession>();
    private readonly socketsByRoom = new Map<string, Map<string, string>>();

    bind(socketId: string, session: ParticipantSession): ParticipantSession | undefined {
        const previous = this.unbind(socketId);
        this.sessions.set(socketId, { roomCode: session.roomCode, participantId: session.participantId });
        const sockets = this.socketsByRoom.get(session.roomCode) ?? new Map<string, string>();
        sockets.set(socketId, session.participantId);
        this.socketsByRoom.set(session.roomCode, sockets);
        return previous;
    }

    unbind(socketId: string): ParticipantSession | undefined {
        const session = this.sessions.get(socketId);
        if (!session) return undefined;
        this.sessions.delete(socketId);
        const sockets = this.socketsByRoom.get(session.roomCode);
        sockets?.delete(socketId);
        if (sockets?.size === 0) this.socketsByRoom.delete(session.roomCode);
        return session;
    }

    unbindParticipant(session: ParticipantSession): string[] {
        const socketIds = this.socketsOf(session.roomCode)
            .filter(({ participantId }) => participantId === session.participantId)
            .map(({ socketId }) => socketId);
        socketIds.forEach((socketId) => this.unbind(socketId));
        return socketIds;
    }

    find(socketId: string): ParticipantSession | undefined {
        return this.sessions.get(socketId);
    }

    require(socketId: string): ParticipantSession {
        const session = this.find(socketId);
        if (!session) throw domainErrors.forbidden('not_in_room');
        return session;
    }

    socketsOf(roomCode: string): SeatedSocket[] {
        return Array.from(this.socketsByRoom.get(roomCode) ?? [], ([socketId, participantId]) => ({
            socketId,
            participantId,
        }));
    }

    isConnected(session: ParticipantSession): boolean {
        return this.socketsOf(session.roomCode).some(({ participantId }) => participantId === session.participantId);
    }
}
