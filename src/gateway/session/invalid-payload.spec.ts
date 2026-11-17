import { z } from 'zod';
import {
    INVALID_PAYLOAD_MAX_ISSUES,
    INVALID_PAYLOAD_TEXT_MAX_LENGTH,
    roomCreatePayloadSchema,
    roundVotePayloadSchema,
} from '../../contracts';
import { invalidPayloadFrom } from './invalid-payload';

const SECRET = 'valor-secreto-do-cliente';

const issuesOf = (schema: z.ZodType, payload: unknown) => {
    const result = schema.safeParse(payload);
    if (result.success) throw new Error('Expected the payload to be invalid');
    return invalidPayloadFrom(result.error.issues);
};

describe('invalidPayloadFrom', () => {
    it('describes a wrong type with a fixed message and the schema path', () => {
        expect(issuesOf(roundVotePayloadSchema, { roundId: 'x', value: null })).toEqual({
            code: 'invalid_payload',
            issues: [{ path: 'roundId', message: 'invalid_type' }],
        });
    });

    it('never echoes the received value or the unknown key names', () => {
        const error = issuesOf(roundVotePayloadSchema, { roundId: 1, value: null, [SECRET]: SECRET });
        expect(JSON.stringify(error)).not.toContain(SECRET);
        expect(error).toEqual({ code: 'invalid_payload', issues: [{ path: '', message: 'unrecognized_keys' }] });
    });

    it('never echoes a text that failed validation', () => {
        const error = issuesOf(roomCreatePayloadSchema, { roomName: SECRET.repeat(5), participantName: 'Ana' });
        expect(JSON.stringify(error)).not.toContain(SECRET);
        expect(error.issues[0]).toEqual({ path: 'roomName', message: 'too_big' });
    });

    it('describes a payload that is not an object', () => {
        expect(issuesOf(roundVotePayloadSchema, undefined).issues).toEqual([{ path: '', message: 'invalid_type' }]);
    });

    it('caps the number of issues and the size of each text', () => {
        const manyIssues = Array.from({ length: 50 }, (_, index) => ({
            code: 'custom' as const,
            path: ['x'.repeat(500), index],
            message: SECRET,
            input: SECRET,
        }));
        const error = invalidPayloadFrom(manyIssues);
        expect(error.issues).toHaveLength(INVALID_PAYLOAD_MAX_ISSUES);
        expect(error.issues[0].path.length).toBeLessThanOrEqual(INVALID_PAYLOAD_TEXT_MAX_LENGTH);
        expect(error.issues[0].message).toBe('custom');
    });
});
