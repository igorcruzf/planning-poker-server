import { Injectable } from '@nestjs/common';
import {
    HumanRole,
    RoomCreatePayload,
    RoomJoinPayload,
    RoomSession,
    RoomSettingsPatch,
    RoomState,
} from '../contracts';
import { domainErrors } from './domain-error';
import { CurrentIssue, FinalizeRequest, PhaseOutcome, RevealRequest, Room, RoundTarget, VoteRequest } from './room';
import { RoomRepository } from './room.repository';
import { snapshotFor } from './snapshot';

export interface KiroSeat {
    roomCode: string;
    roomName: string;
    participantId: string;
    seatName: string;
}

@Injectable()
export class RoomService {
    constructor(private readonly rooms: RoomRepository) {}

    getRoom(roomCode: string): Room {
        return this.rooms.require(roomCode);
    }

    createRoom(payload: RoomCreatePayload): RoomSession {
        const room = this.rooms.create(payload);
        const { participantId, sessionToken } = room.join({ name: payload.participantName, role: 'player' });
        return { roomCode: room.code, participantId, sessionToken };
    }

    join(payload: RoomJoinPayload): RoomSession {
        const room = this.rooms.require(payload.roomCode);
        const { participantId, sessionToken } = room.join(payload);
        return { roomCode: room.code, participantId, sessionToken };
    }

    leave(roomCode: string, participantId: string): void {
        this.rooms.require(roomCode).leave(participantId);
    }

    connect(roomCode: string, participantId: string): void {
        this.rooms.require(roomCode).markConnected(participantId);
    }

    disconnect(roomCode: string, participantId: string): void {
        this.rooms.require(roomCode).markDisconnected(participantId);
    }

    setRole(roomCode: string, participantId: string, role: HumanRole): void {
        this.rooms.require(roomCode).setRole(participantId, role);
    }

    updateSettings(roomCode: string, actorId: string, patch: RoomSettingsPatch): void {
        this.rooms.require(roomCode).updateSettings(actorId, patch);
    }

    transferFacilitator(roomCode: string, actorId: string, targetId: string): void {
        this.rooms.require(roomCode).transferFacilitator(actorId, targetId);
    }

    setCurrentIssue(roomCode: string, actorId: string, issue: CurrentIssue | null): void {
        this.rooms.require(roomCode).setCurrentIssue(actorId, issue);
    }

    vote(roomCode: string, actorId: string, request: VoteRequest): PhaseOutcome {
        return this.rooms.require(roomCode).vote(actorId, request);
    }

    reveal(roomCode: string, actorId: string, request: RevealRequest): PhaseOutcome {
        return this.rooms.require(roomCode).reveal(actorId, request);
    }

    finishCountdown(roomCode: string, roundId: number): PhaseOutcome {
        return this.rooms.require(roomCode).finishCountdown(roundId);
    }

    reset(roomCode: string, actorId: string, request: RoundTarget): void {
        this.rooms.require(roomCode).reset(actorId, request);
    }

    finalize(roomCode: string, actorId: string, request: FinalizeRequest): void {
        this.rooms.require(roomCode).finalize(actorId, request);
    }

    snapshot(roomCode: string, viewerId: string | null): RoomState {
        return snapshotFor(this.rooms.require(roomCode), viewerId);
    }

    createKiroInvite(roomCode: string, ownerId: string): { inviteCode: string; expiresAt: number } {
        return this.rooms.require(roomCode).createKiroInvite(ownerId);
    }

    redeemKiroInvite(inviteCode: string): KiroSeat {
        const room = this.rooms.findByKiroInvite(inviteCode);
        if (!room) throw domainErrors.inviteInvalid();
        const { participantId, seatName } = room.redeemKiroInvite(inviteCode);
        return { roomCode: room.code, roomName: room.name, participantId, seatName };
    }

    castKiroVote(roomCode: string, botId: string, request: { value: string; rationale: string }): PhaseOutcome {
        return this.rooms.require(roomCode).castKiroVote(botId, request);
    }
}
