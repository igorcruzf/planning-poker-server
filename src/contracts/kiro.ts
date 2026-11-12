import { z } from 'zod';
import { cardStateSchema, specialCardSchema, voteValueSchema } from './deck';
import { httpUrlSchema, participantIdSchema, secretTokenSchema, timestampSchema } from './primitives';
import { namedVoteSchema, roundIdSchema } from './round';

export const KIRO_MAX_PER_OWNER = 1;
export const KIRO_MAX_PER_ROOM = 3;
export const KIRO_INVITE_TTL_MS = 10 * 60 * 1000;
export const KIRO_SEAT_NAME_PREFIX = 'Kiro do ';
export const KIRO_RATIONALE_MAX_LENGTH = 280;
export const WAIT_FOR_ROUND_MAX_TIMEOUT_S = 90;
export const MCP_PATH = '/mcp';
export const MCP_PRODUCTION_URL = 'https://planning-poker-server-slaf.onrender.com/mcp';

export const kiroInviteCodeSchema = secretTokenSchema;

export const kiroInviteSchema = z.object({
    inviteCode: kiroInviteCodeSchema,
    mcpUrl: httpUrlSchema,
    expiresAt: timestampSchema,
});
export type KiroInvite = z.infer<typeof kiroInviteSchema>;

export const kiroToolNameSchema = z.enum(['join_table', 'get_round', 'wait_for_round', 'cast_vote', 'leave_table']);
export type KiroToolName = z.infer<typeof kiroToolNameSchema>;
export const KIRO_TOOL_NAMES = kiroToolNameSchema.options;

export const joinTableInputSchema = z.strictObject({ invite: kiroInviteCodeSchema });
export type JoinTableInput = z.infer<typeof joinTableInputSchema>;

export const joinTableOutputSchema = z.object({
    participantId: participantIdSchema,
    seatName: z.string(),
    roomName: z.string(),
});
export type JoinTableOutput = z.infer<typeof joinTableOutputSchema>;

export const getRoundInputSchema = z.strictObject({});
export type GetRoundInput = z.infer<typeof getRoundInputSchema>;

export const kiroRoundSchema = z.discriminatedUnion('phase', [
    z.object({ id: roundIdSchema, phase: z.literal('voting') }),
    z.object({ id: roundIdSchema, phase: z.literal('countdown'), revealAt: timestampSchema }),
    z.object({
        id: roundIdSchema,
        phase: z.literal('revealed'),
        votes: z.array(namedVoteSchema),
        finalEstimate: z.string().nullable(),
    }),
]);
export type KiroRound = z.infer<typeof kiroRoundSchema>;

export const getRoundOutputSchema = z.object({
    roomName: z.string(),
    issue: z
        .object({ key: z.string(), summary: z.string(), issueType: z.string(), url: httpUrlSchema })
        .nullable(),
    deck: z.object({ cards: z.array(cardStateSchema), specialCards: z.array(specialCardSchema) }),
    kiroCountsAsPlayer: z.boolean(),
    yourVote: z.object({ value: z.string(), rationale: z.string() }).nullable(),
    round: kiroRoundSchema,
});
export type GetRoundOutput = z.infer<typeof getRoundOutputSchema>;

export const waitForRoundInputSchema = z.strictObject({
    timeout_s: z.number().int().positive().max(WAIT_FOR_ROUND_MAX_TIMEOUT_S),
});
export type WaitForRoundInput = z.infer<typeof waitForRoundInputSchema>;

export const waitForRoundChangeSchema = z.enum(['new_round', 'issue_changed', 'timeout']);
export type WaitForRoundChange = z.infer<typeof waitForRoundChangeSchema>;

export const waitForRoundOutputSchema = getRoundOutputSchema.extend({ change: waitForRoundChangeSchema });
export type WaitForRoundOutput = z.infer<typeof waitForRoundOutputSchema>;

export const castVoteInputSchema = z.strictObject({
    value: voteValueSchema,
    rationale: z.string().trim().min(1).max(KIRO_RATIONALE_MAX_LENGTH),
});
export type CastVoteInput = z.infer<typeof castVoteInputSchema>;

export const castVoteOutputSchema = z.object({ roundId: roundIdSchema, value: z.string(), rationale: z.string() });
export type CastVoteOutput = z.infer<typeof castVoteOutputSchema>;

export const leaveTableInputSchema = z.strictObject({});
export type LeaveTableInput = z.infer<typeof leaveTableInputSchema>;

export const leaveTableOutputSchema = z.object({ left: z.literal(true) });
export type LeaveTableOutput = z.infer<typeof leaveTableOutputSchema>;

export const KIRO_TOOLS = {
    join_table: { input: joinTableInputSchema, output: joinTableOutputSchema },
    get_round: { input: getRoundInputSchema, output: getRoundOutputSchema },
    wait_for_round: { input: waitForRoundInputSchema, output: waitForRoundOutputSchema },
    cast_vote: { input: castVoteInputSchema, output: castVoteOutputSchema },
    leave_table: { input: leaveTableInputSchema, output: leaveTableOutputSchema },
} as const satisfies Record<KiroToolName, { readonly input: z.ZodObject; readonly output: z.ZodObject }>;
