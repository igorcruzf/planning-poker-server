import { z } from 'zod';
import {
    castVoteInputSchema,
    CLIENT_EVENTS,
    getRoundOutputSchema,
    KIRO_INVITE_TTL_MS,
    KIRO_MAX_PER_OWNER,
    KIRO_MAX_PER_ROOM,
    KIRO_RATIONALE_MAX_LENGTH,
    KIRO_SEAT_NAME_PREFIX,
    KIRO_TOOL_NAMES,
    KIRO_TOOLS,
    kiroInviteSchema,
    MCP_PATH,
    MCP_PRODUCTION_URL,
    WAIT_FOR_ROUND_MAX_TIMEOUT_S,
    waitForRoundInputSchema,
    waitForRoundOutputSchema,
} from '../contracts';

const INVITE = 'i'.repeat(43);

const table = {
    roomName: 'Refinamento Yak',
    issue: {
        key: 'YAK-1234',
        summary: '[installments-service] Ajustar cache de opções de parcelas',
        issueType: 'História',
        url: 'https://jiraps.atlassian.net/browse/YAK-1234',
    },
    deck: {
        cards: [
            { value: 'PP', meaning: 'até 3 dias' },
            { value: 'P', meaning: 'até 5 dias' },
            { value: 'M', meaning: 'até 10 dias' },
            { value: 'G', meaning: '10+ dias' },
        ],
        specialCards: ['?', 'yakult'],
    },
    kiroCountsAsPlayer: false,
    yourVote: null,
    round: { id: 4, phase: 'voting' },
};

describe('kiro tools', () => {
    it('has the 5 tools of the plan with their exact names', () => {
        expect(KIRO_TOOL_NAMES).toEqual(['join_table', 'get_round', 'wait_for_round', 'cast_vote', 'leave_table']);
        expect(Object.keys(KIRO_TOOLS)).toEqual(KIRO_TOOL_NAMES);
    });

    it.each(KIRO_TOOL_NAMES)('exposes %s with input and output schemas the MCP SDK can publish', (name) => {
        const { input, output } = KIRO_TOOLS[name];
        const inputJson = z.toJSONSchema(input, { io: 'input', target: 'draft-7' });
        const outputJson = z.toJSONSchema(output, { io: 'output', target: 'draft-7' });

        expect(inputJson).toMatchObject({ type: 'object', additionalProperties: false });
        expect(outputJson).toMatchObject({ type: 'object' });
    });

    it('joins the table with the invite', () => {
        expect(KIRO_TOOLS.join_table.input.parse({ invite: INVITE })).toEqual({ invite: INVITE });
        expect(KIRO_TOOLS.join_table.input.safeParse({ invite: 'nope' }).success).toBe(false);
    });

    it.each(['get_round', 'leave_table'] as const)('%s takes no arguments', (name) => {
        expect(KIRO_TOOLS[name].input.parse({})).toEqual({});
    });
});

describe('wait_for_round', () => {
    it('waits at most 90 seconds', () => {
        expect(WAIT_FOR_ROUND_MAX_TIMEOUT_S).toBe(90);
        expect(waitForRoundInputSchema.parse({ timeout_s: 90 })).toEqual({ timeout_s: 90 });
    });

    it.each([91, 0, -5, 1.5, '90'])('rejects timeout_s %p', (timeout_s) => {
        expect(waitForRoundInputSchema.safeParse({ timeout_s }).success).toBe(false);
    });

    it('tells what changed and returns the table', () => {
        const output = { ...table, change: 'new_round' };

        expect(waitForRoundOutputSchema.parse(output)).toEqual(output);
    });
});

describe('cast_vote', () => {
    it('accepts a rationale with 280 characters and rejects one with 281', () => {
        expect(KIRO_RATIONALE_MAX_LENGTH).toBe(280);
        expect(castVoteInputSchema.safeParse({ value: 'G', rationale: 'x'.repeat(280) }).success).toBe(true);
        expect(castVoteInputSchema.safeParse({ value: 'G', rationale: 'x'.repeat(281) }).success).toBe(false);
    });

    it('accepts a rationale with line breaks', () => {
        expect(castVoteInputSchema.safeParse({ value: 'G', rationale: 'Mexe em dois serviços.\nQuebrar.' }).success).toBe(
            true,
        );
    });

    it.each([{ value: 'G' }, { value: 'G', rationale: '  ' }, { value: 'TOO_BIG', rationale: 'x' }])(
        'rejects %o',
        (input) => {
            expect(castVoteInputSchema.safeParse(input).success).toBe(false);
        },
    );
});

describe('get_round', () => {
    it('returns the card, the deck with the room ruler and the phase', () => {
        expect(getRoundOutputSchema.parse(table)).toEqual(table);
    });

    it('never comes out with the votes of the others while voting', () => {
        const leaky = {
            ...table,
            round: { ...table.round, votes: [{ name: 'Ana', value: 'M' }], kiroGuesses: [{ name: 'x', value: 'G' }] },
        };
        const result = getRoundOutputSchema.safeParse(leaky);

        expect(!result.success || !('votes' in result.data.round || 'kiroGuesses' in result.data.round)).toBe(true);
    });

    it('returns the votes after the reveal', () => {
        const revealed = {
            ...table,
            yourVote: { value: 'G', rationale: 'Grande.' },
            round: { id: 4, phase: 'revealed', votes: [{ name: 'Ana', value: 'M' }], finalEstimate: 'M' },
        };

        expect(getRoundOutputSchema.parse(revealed)).toEqual(revealed);
    });
});

describe('kiro invite', () => {
    it('is asked by the table through kiro:invite', () => {
        expect(CLIENT_EVENTS['kiro:invite'].payload.parse({})).toEqual({});
        expect(CLIENT_EVENTS['kiro:invite'].result).toBe(kiroInviteSchema);
    });

    it('answers with the invite code and the MCP url for the text pasted in the Kiro chat', () => {
        const invite = { inviteCode: INVITE, mcpUrl: MCP_PRODUCTION_URL, expiresAt: 1_700_000_600_000 };

        expect(kiroInviteSchema.parse(invite)).toEqual(invite);
        expect(MCP_PRODUCTION_URL).toBe('https://planning-poker-server-slaf.onrender.com/mcp');
        expect(MCP_PATH).toBe('/mcp');
    });

    it('expires in 10 minutes', () => {
        expect(KIRO_INVITE_TTL_MS).toBe(10 * 60 * 1000);
    });
});

describe('kiro limits', () => {
    it('allows 1 Kiro per person and 3 per room', () => {
        expect(KIRO_MAX_PER_OWNER).toBe(1);
        expect(KIRO_MAX_PER_ROOM).toBe(3);
    });

    it('names the bot seat "Kiro do {owner}"', () => {
        expect(`${KIRO_SEAT_NAME_PREFIX}Igor`).toBe('Kiro do Igor');
    });
});
