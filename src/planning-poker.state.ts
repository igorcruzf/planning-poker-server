import { Injectable } from '@nestjs/common';
import { Identifier, toKey, UserChanges, UserInfo } from './user-info';
import { clearVote } from './vote';

interface Participant {
    user: UserInfo;
    socketIds: Set<string>;
}

interface Room {
    participants: Map<string, Participant>;
    revealed: boolean;
}

interface SocketSession {
    roomKey: string;
    userKey: string;
}

interface Connection {
    session: SocketSession;
    room: Room;
    participant: Participant;
}

export interface Departure {
    room: string;
    user: UserInfo;
    lastConnection: boolean;
}

@Injectable()
export class PlanningPokerState {
    private readonly rooms = new Map<string, Room>();
    private readonly sessions = new Map<string, SocketSession>();

    join(socketId: string, user: UserInfo): Departure | undefined {
        const roomKey = toKey(user.room);
        const userKey = toKey(user.id);
        const current = this.sessions.get(socketId);
        const isSameSession = current?.roomKey === roomKey && current?.userKey === userKey;
        const departure = current && !isSameSession ? this.leave(socketId) : undefined;

        const room = this.getOrCreateRoom(roomKey);
        const participant = room.participants.get(userKey);
        if (participant) {
            participant.user = user;
            participant.socketIds.add(socketId);
        } else {
            room.participants.set(userKey, { user, socketIds: new Set([socketId]) });
        }
        this.sessions.set(socketId, { roomKey, userKey });

        return departure;
    }

    update(socketId: string, changes: UserChanges): UserInfo | undefined {
        const connection = this.findConnection(socketId);
        if (!connection) {
            return undefined;
        }
        const { participant } = connection;
        participant.user = { ...changes, id: participant.user.id, room: participant.user.room };
        return participant.user;
    }

    reveal(socketId: string): string | undefined {
        const connection = this.findConnection(socketId);
        if (!connection) {
            return undefined;
        }
        connection.room.revealed = true;
        return connection.session.roomKey;
    }

    startNewRound(socketId: string): string | undefined {
        const connection = this.findConnection(socketId);
        if (!connection) {
            return undefined;
        }
        const { room, session } = connection;
        room.revealed = false;
        room.participants.forEach((participant) => (participant.user = clearVote(participant.user)));
        return session.roomKey;
    }

    leave(socketId: string): Departure | undefined {
        const connection = this.findConnection(socketId);
        this.sessions.delete(socketId);
        if (!connection) {
            return undefined;
        }

        const { session, room, participant } = connection;
        participant.socketIds.delete(socketId);

        const lastConnection = participant.socketIds.size === 0;
        if (lastConnection) {
            room.participants.delete(session.userKey);
        }
        if (room.participants.size === 0) {
            this.rooms.delete(session.roomKey);
        }

        return { room: session.roomKey, user: participant.user, lastConnection };
    }

    usersIn(room: Identifier): UserInfo[] {
        const participants = this.rooms.get(toKey(room))?.participants.values() ?? [];
        return Array.from(participants, (participant) => participant.user);
    }

    isRevealed(room: Identifier): boolean {
        return this.rooms.get(toKey(room))?.revealed ?? false;
    }

    private findConnection(socketId: string): Connection | undefined {
        const session = this.sessions.get(socketId);
        const room = session && this.rooms.get(session.roomKey);
        const participant = session && room?.participants.get(session.userKey);
        return session && room && participant ? { session, room, participant } : undefined;
    }

    private getOrCreateRoom(roomKey: string): Room {
        let room = this.rooms.get(roomKey);
        if (!room) {
            room = { participants: new Map(), revealed: false };
            this.rooms.set(roomKey, room);
        }
        return room;
    }
}
