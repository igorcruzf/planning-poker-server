import { AppError, ForbiddenReason, KIRO_MAX_PER_OWNER, KIRO_MAX_PER_ROOM, RoundPhase } from '../contracts';

export class DomainError extends Error {
    constructor(readonly error: AppError) {
        super(error.code);
        this.name = 'DomainError';
    }
}

const NAME_TAKEN_ISSUE = { path: 'name', message: 'name_taken' };

export const domainErrors = {
    forbidden: (reason: ForbiddenReason) => new DomainError({ code: 'forbidden', reason }),
    votesPending: (missing: { participantId: string; name: string }[]) =>
        new DomainError({ code: 'votes_pending', missing }),
    wrongPhase: (phase: RoundPhase) => new DomainError({ code: 'wrong_phase', phase }),
    roomNotFound: (serverInstanceId: string) => new DomainError({ code: 'room_not_found', serverInstanceId }),
    kiroLimitPerOwner: () => new DomainError({ code: 'kiro_limit_per_owner', limit: KIRO_MAX_PER_OWNER }),
    kiroLimitPerRoom: () => new DomainError({ code: 'kiro_limit_per_room', limit: KIRO_MAX_PER_ROOM }),
    roundStale: () => new DomainError({ code: 'round_stale' }),
    invalidVote: () => new DomainError({ code: 'invalid_vote' }),
    invalidTarget: () => new DomainError({ code: 'invalid_target' }),
    sessionTokenInvalid: () => new DomainError({ code: 'session_token_invalid' }),
    spectatorsDisabled: () => new DomainError({ code: 'spectators_disabled' }),
    kiroDisabled: () => new DomainError({ code: 'kiro_disabled' }),
    inviteInvalid: () => new DomainError({ code: 'invite_invalid' }),
    nameTaken: () => new DomainError({ code: 'invalid_payload', issues: [NAME_TAKEN_ISSUE] }),
};
