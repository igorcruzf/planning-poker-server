import { z } from 'zod';
import { cardStateSchema, cardValueSchema, voteValueSchema } from './deck';
import { durationMsSchema, participantIdSchema, timestampSchema } from './primitives';

export const roundPhaseSchema = z.enum(['voting', 'countdown', 'revealed']);
export type RoundPhase = z.infer<typeof roundPhaseSchema>;

export const roundIdSchema = z.number().int().positive();
export type RoundId = z.infer<typeof roundIdSchema>;

export const roundVotePayloadSchema = z.strictObject({ roundId: roundIdSchema, value: voteValueSchema.nullable() });
export type RoundVotePayload = z.infer<typeof roundVotePayloadSchema>;

export const roundRevealPayloadSchema = z.strictObject({
    roundId: roundIdSchema,
    confirmMissingVotes: z.boolean().default(false),
});
export type RoundRevealPayload = z.infer<typeof roundRevealPayloadSchema>;

export const roundResetPayloadSchema = z.strictObject({ roundId: roundIdSchema });
export type RoundResetPayload = z.infer<typeof roundResetPayloadSchema>;

export const roundFinalizePayloadSchema = z.strictObject({ roundId: roundIdSchema, value: cardValueSchema });
export type RoundFinalizePayload = z.infer<typeof roundFinalizePayloadSchema>;

export const revealedVoteSchema = z.object({ participantId: participantIdSchema, name: z.string(), value: z.string() });
export type RevealedVote = z.infer<typeof revealedVoteSchema>;

export const kiroGuessSchema = revealedVoteSchema.extend({ rationale: z.string() });
export type KiroGuess = z.infer<typeof kiroGuessSchema>;

const roundStateFields = { id: roundIdSchema, issueKey: z.string().nullable() };

export const votingRoundStateSchema = z.object({
    ...roundStateFields,
    phase: z.literal('voting'),
    pendingVoterIds: z.array(participantIdSchema),
});

export const countdownRoundStateSchema = votingRoundStateSchema.extend({
    phase: z.literal('countdown'),
    revealAt: timestampSchema,
    countdownMs: durationMsSchema,
});

export const revealedRoundStateSchema = z.object({
    ...roundStateFields,
    phase: z.literal('revealed'),
    revealedAt: timestampSchema,
    votes: z.array(revealedVoteSchema),
    kiroGuesses: z.array(kiroGuessSchema),
    finalEstimate: z.string().nullable(),
});

export const roundStateSchema = z.discriminatedUnion('phase', [
    votingRoundStateSchema,
    countdownRoundStateSchema,
    revealedRoundStateSchema,
]);
export type RoundState = z.infer<typeof roundStateSchema>;

const namedValueSchema = z.object({ name: z.string(), value: z.string() });

export const historyEntrySchema = z.object({
    roundId: roundIdSchema,
    issue: z.object({ key: z.string(), summary: z.string() }).nullable(),
    finalEstimate: cardStateSchema.nullable(),
    votes: z.array(namedValueSchema),
    kiroGuesses: z.array(namedValueSchema),
    kiroCountedAsPlayer: z.boolean(),
    revealedAt: timestampSchema,
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
