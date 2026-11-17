import { Injectable } from '@nestjs/common';
import {
    CastVoteInput,
    CastVoteOutput,
    GetRoundOutput,
    JoinTableOutput,
    LeaveTableOutput,
    WaitForRoundChange,
    WaitForRoundOutput,
} from '../contracts';
import { DomainError, domainErrors } from '../domain/domain-error';
import { Room } from '../domain/room';
import { RoomService } from '../domain/room.service';
import { Scheduler } from '../gateway/session/scheduler';
import { roundMarkerOf, roundViewFor } from './kiro-round-view';
import { KiroSeatBinding, KiroSession, RoundMarker } from './kiro-session';
const MILLISECONDS_PER_SECOND = 1000;
const CONCURRENT_WAIT_RETRY_MS = 1000;
const changeSince = (seen: RoundMarker | null, now: RoundMarker): WaitForRoundChange | null => {
    if (!seen) return null;
    if (now.issueKey !== seen.issueKey) return 'issue_changed';
    if (now.roundId !== seen.roundId) return 'new_round';
    return null;
};
@Injectable()
export class KiroTableService {
    constructor(
        private readonly rooms: RoomService,
        private readonly scheduler: Scheduler,
    ) {}
    join(session: KiroSession, invite: string): JoinTableOutput {
        if (session.isClosed || session.seat) throw domainErrors.inviteInvalid();
        const seat = this.rooms.redeemKiroInvite(invite);
        const binding = {
            roomCode: seat.roomCode,
            participantId: seat.participantId,
        };
        session.sit(binding, roundMarkerOf(this.rooms.getRoom(seat.roomCode)));
        return {
            participantId: seat.participantId,
            seatName: seat.seatName,
            roomName: seat.roomName,
        };
    }
    getRound(session: KiroSession): GetRoundOutput {
        const { room, binding } = this.requireTable(session);
        session.markSeen(roundMarkerOf(room));
        return roundViewFor(room, binding.participantId, room.name);
    }
    async waitForRound(session: KiroSession, timeoutSeconds: number): Promise<WaitForRoundOutput> {
        const { binding } = this.requireTable(session);
        if (session.isWaiting)
            throw new DomainError({
                code: 'rate_limited',
                retryAfterMs: CONCURRENT_WAIT_RETRY_MS,
            });
        session.beginWait();
        try {
            if (!this.detectChange(session, binding)) {
                await this.sleepUntilChange(session, binding, timeoutSeconds * MILLISECONDS_PER_SECOND);
            }
        } finally {
            session.endWait();
        }
        const { room } = this.requireTable(session);
        const change = this.detectChange(session, binding) ?? 'timeout';
        session.markSeen(roundMarkerOf(room));
        return { ...roundViewFor(room, binding.participantId, room.name), change };
    }
    castVote(session: KiroSession, input: CastVoteInput): CastVoteOutput {
        const { binding } = this.requireTable(session);
        const outcome = this.rooms.castKiroVote(binding.roomCode, binding.participantId, input);
        session.markSeen(roundMarkerOf(this.rooms.getRoom(binding.roomCode)));
        return {
            roundId: outcome.roundId,
            value: input.value,
            rationale: input.rationale,
        };
    }
    leave(session: KiroSession): LeaveTableOutput {
        const binding = session.requireSeat();
        try {
            this.rooms.leave(binding.roomCode, binding.participantId);
        } catch (error) {
            if (!(error instanceof DomainError)) throw error;
        }
        session.close();
        return { left: true };
    }
    private requireTable(session: KiroSession): {
        room: Room;
        binding: KiroSeatBinding;
    } {
        const binding = session.requireSeat();
        const room = this.rooms.getRoom(binding.roomCode);
        if (room.findParticipant(binding.participantId)?.role !== 'bot') throw domainErrors.forbidden('not_in_room');
        return { room, binding };
    }
    private detectChange(session: KiroSession, binding: KiroSeatBinding): WaitForRoundChange | null {
        return changeSince(session.seen, roundMarkerOf(this.rooms.getRoom(binding.roomCode)));
    }
    private sleepUntilChange(session: KiroSession, binding: KiroSeatBinding, timeoutMs: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const finish = () => {
                unsubscribe();
                cancelTimer();
                forgetClose();
                resolve();
            };
            const wakeIfRelevant = () => {
                try {
                    this.requireTable(session);
                    if (this.detectChange(session, binding)) finish();
                } catch {
                    finish();
                }
            };
            const unsubscribe = this.rooms.onChange(({ roomCode }) => {
                if (roomCode === binding.roomCode) wakeIfRelevant();
            });
            const cancelTimer = this.scheduler.after(timeoutMs, finish);
            const forgetClose = session.onClose(finish);
        });
    }
}
