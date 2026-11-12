import { Injectable } from '@nestjs/common';
import { Identifier, toKey, UserChanges, UserInfo } from './user-info';

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
        const participant = this.findParticipant(socketId);
        if (!participant) {
            return undefined;
        }
        participant.user = { ...changes, id: participant.user.id, room: participant.user.room };
        return participant.user;
    }

    setRevealed(socketId: string, revealed: boolean): string | undefined {
        const session = this.sessions.get(socketId);
        if (!session) {
            return undefined;
        }
        this.rooms.get(session.roomKey).revealed = revealed;
        return session.roomKey;
    }

    leave(socketId: string): Departure | undefined {
        const session = this.sessions.get(socketId);
        if (!session) {
            return undefined;
        }
        this.sessions.delete(socketId);

        const room = this.rooms.get(session.roomKey);
        const participant = room.participants.get(session.userKey);
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

    private findParticipant(socketId: string): Participant | undefined {
        const session = this.sessions.get(socketId);
        return session && this.rooms.get(session.roomKey).participants.get(session.userKey);
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
