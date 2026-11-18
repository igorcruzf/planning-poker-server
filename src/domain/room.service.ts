import { Injectable } from '@nestjs/common';
import {
    HumanRole,
    JiraRoomState,
    RoomCreatePayload,
    RoomJoinPayload,
    RoomSession,
    RoomSettingsPatch,
    RoomState,
} from '../contracts';
import { ChangeListener, ChangeNotifier } from './change-notifier';
import { domainErrors } from './domain-error';
import {
    CurrentIssue,
    FinalizeRequest,
    KiroVoteOutcome,
    PhaseOutcome,
    RevealRequest,
    Room,
    RoundTarget,
    VoteRequest,
} from './room';
import { ParticipantView } from './participant';
import { RoomRepository } from './room.repository';
import { snapshotFor } from './snapshot';

export interface KiroSeat {
    roomCode: string;
    roomName: string;
    participantId: string;
    seatName: string;
}

export type RoomChangeReason =
    | 'created'
    | 'joined'
    | 'left'
    | 'connected'
    | 'disconnected'
    | 'role_changed'
    | 'settings_updated'
    | 'umbrella_changed'
    | 'facilitator_transferred'
    | 'issue_changed'
    | 'jira_updated'
    | 'voted'
    | 'revealed'
    | 'countdown_finished'
    | 'reset'
    | 'finalized'
    | 'kiro_invite_created'
    | 'kiro_seated'
    | 'kiro_voted'
    | 'settled';

export interface RoomChange {
    roomCode: string;
    reason: RoomChangeReason;
}

@Injectable()
export class RoomService {
    private readonly changes = new ChangeNotifier<RoomChange>();
    private readonly publishedPendingVoters = new WeakMap<Room, string>();

    constructor(private readonly rooms: RoomRepository) {
        this.rooms.onPruned((roomCode) => this.changes.notify({ roomCode, reason: 'left' }));
    }

    onChange(listener: ChangeListener<RoomChange>): () => void {
        return this.changes.subscribe(listener);
    }

    getRoom(roomCode: string): Room {
        return this.rooms.require(roomCode);
    }

    nextPresenceDeadline(roomCode: string): number | null {
        return this.rooms.require(roomCode).nextPresenceDeadline();
    }

    settle(roomCode: string): PhaseOutcome {
        const room = this.rooms.require(roomCode);
        const phaseBefore = room.phase;
        const outcome = room.settle();
        const pendingVotersChanged = this.publishedPendingVoters.get(room) !== pendingVotersKey(room);
        if (outcome.phase !== phaseBefore || pendingVotersChanged) this.publish(room, 'settled');
        return outcome;
    }

    createRoom(payload: RoomCreatePayload): RoomSession {
        const room = this.rooms.create(payload);
        try {
            const { participantId, sessionToken } = room.join({ name: payload.participantName, role: 'player' });
            this.publish(room, 'created');
            return { roomCode: room.code, participantId, sessionToken };
        } catch (error) {
            this.rooms.discard(room.code);
            throw error;
        }
    }

    join(payload: RoomJoinPayload): RoomSession {
        return this.mutate(payload.roomCode, 'joined', (room) => {
            const { participantId, sessionToken } = room.join(payload);
            return { roomCode: room.code, participantId, sessionToken };
        });
    }

    leave(roomCode: string, participantId: string): void {
        this.mutate(roomCode, 'left', (room) => room.leave(participantId));
    }

    connect(roomCode: string, participantId: string): void {
        this.mutate(roomCode, 'connected', (room) => room.markConnected(participantId));
    }

    disconnect(roomCode: string, participantId: string): void {
        this.mutateIfChanged(roomCode, 'disconnected', (room) => room.markDisconnected(participantId));
    }

    setRole(roomCode: string, participantId: string, role: HumanRole): void {
        this.mutateIfChanged(roomCode, 'role_changed', (room) => room.setRole(participantId, role));
    }

    updateSettings(roomCode: string, actorId: string, patch: RoomSettingsPatch): void {
        this.mutateIfChanged(roomCode, 'settings_updated', (room) => room.updateSettings(actorId, patch));
    }

    setUmbrella(roomCode: string, participantId: string, enabled: boolean): void {
        this.mutateIfChanged(roomCode, 'umbrella_changed', (room) => room.setUmbrella(participantId, enabled));
    }

    authenticate(roomCode: string, sessionToken: string): ParticipantView {
        return this.rooms.require(roomCode).authenticate(sessionToken);
    }

    transferFacilitator(roomCode: string, actorId: string, targetId: string): void {
        this.mutate(roomCode, 'facilitator_transferred', (room) => room.transferFacilitator(actorId, targetId));
    }

    setCurrentIssue(roomCode: string, actorId: string, issue: CurrentIssue | null): void {
        this.mutate(roomCode, 'issue_changed', (room) => room.setCurrentIssue(actorId, issue));
    }

    setJiraState(roomCode: string, jira: JiraRoomState | null): void {
        this.mutate(roomCode, 'jira_updated', (room) => room.setJiraState(jira));
    }

    vote(roomCode: string, actorId: string, request: VoteRequest): PhaseOutcome {
        return this.mutate(roomCode, 'voted', (room) => room.vote(actorId, request));
    }

    reveal(roomCode: string, actorId: string, request: RevealRequest): PhaseOutcome {
        return this.mutateOnPhaseChange(roomCode, 'revealed', (room) => room.reveal(actorId, request));
    }

    finishCountdown(roomCode: string, roundId: number): PhaseOutcome {
        return this.mutateOnPhaseChange(roomCode, 'countdown_finished', (room) => room.finishCountdown(roundId));
    }

    reset(roomCode: string, actorId: string, request: RoundTarget): void {
        this.mutate(roomCode, 'reset', (room) => room.reset(actorId, request));
    }

    finalize(roomCode: string, actorId: string, request: FinalizeRequest): void {
        this.mutate(roomCode, 'finalized', (room) => room.finalize(actorId, request));
    }

    snapshot(roomCode: string, viewerId: string | null): RoomState {
        return snapshotFor(this.rooms.require(roomCode), viewerId);
    }

    createKiroInvite(roomCode: string, ownerId: string): { inviteCode: string; expiresAt: number } {
        return this.mutate(roomCode, 'kiro_invite_created', (room) => room.createKiroInvite(ownerId));
    }

    redeemKiroInvite(inviteCode: string): KiroSeat {
        const room = this.rooms.findByKiroInvite(inviteCode);
        if (!room) throw domainErrors.inviteInvalid();
        const { participantId, seatName } = room.redeemKiroInvite(inviteCode);
        this.publish(room, 'kiro_seated');
        return { roomCode: room.code, roomName: room.name, participantId, seatName };
    }

    castKiroVote(roomCode: string, botId: string, request: { value: string; rationale: string }): KiroVoteOutcome {
        return this.mutate(roomCode, 'kiro_voted', (room) => room.castKiroVote(botId, request));
    }

    private mutate<Result>(roomCode: string, reason: RoomChangeReason, action: (room: Room) => Result): Result {
        const room = this.rooms.require(roomCode);
        const result = action(room);
        this.publish(room, reason);
        return result;
    }

    private mutateIfChanged(roomCode: string, reason: RoomChangeReason, action: (room: Room) => boolean): void {
        const room = this.rooms.require(roomCode);
        if (action(room)) this.publish(room, reason);
    }

    private mutateOnPhaseChange(
        roomCode: string,
        reason: RoomChangeReason,
        action: (room: Room) => PhaseOutcome,
    ): PhaseOutcome {
        const room = this.rooms.require(roomCode);
        const phaseBefore = room.phase;
        const outcome = action(room);
        if (outcome.phase !== phaseBefore) this.publish(room, reason);
        return outcome;
    }

    private publish(room: Room, reason: RoomChangeReason): void {
        this.publishedPendingVoters.set(room, pendingVotersKey(room));
        this.changes.notify({ roomCode: room.code, reason });
    }
}

const pendingVotersKey = (room: Room): string => JSON.stringify(room.pendingVoterIds());
