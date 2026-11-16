import { appErrorSchema } from '../contracts';
import { DomainError, domainErrors } from './domain-error';

describe('DomainError', () => {
    it('carries an error from the contract catalog and never leaks data in the message', () => {
        const error = domainErrors.forbidden('players_only');
        expect(error).toBeInstanceOf(DomainError);
        expect(error.error).toEqual({ code: 'forbidden', reason: 'players_only' });
        expect(error.message).toBe('forbidden');
        expect(appErrorSchema.safeParse(error.error).success).toBe(true);
    });

    it.each([
        [domainErrors.votesPending([{ participantId: 'p-1', name: 'Ana' }]), 'votes_pending'],
        [domainErrors.wrongPhase('revealed'), 'wrong_phase'],
        [domainErrors.roomNotFound('server-1'), 'room_not_found'],
        [domainErrors.kiroLimitPerOwner(), 'kiro_limit_per_owner'],
        [domainErrors.kiroLimitPerRoom(), 'kiro_limit_per_room'],
        [domainErrors.roundStale(), 'round_stale'],
        [domainErrors.invalidVote(), 'invalid_vote'],
        [domainErrors.invalidTarget(), 'invalid_target'],
        [domainErrors.sessionTokenInvalid(), 'session_token_invalid'],
        [domainErrors.spectatorsDisabled(), 'spectators_disabled'],
        [domainErrors.kiroDisabled(), 'kiro_disabled'],
        [domainErrors.inviteInvalid(), 'invite_invalid'],
        [domainErrors.internal(), 'internal_error'],
        [domainErrors.nameTaken(), 'invalid_payload'],
    ])('builds a schema-valid error for %#', (error, code) => {
        expect(error.error.code).toBe(code);
        expect(appErrorSchema.safeParse(error.error).success).toBe(true);
    });
});
