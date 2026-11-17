import { ZodError } from 'zod';
import { AppErrorOf, INVALID_PAYLOAD_MAX_ISSUES, INVALID_PAYLOAD_TEXT_MAX_LENGTH } from '../../contracts';

type ZodIssues = ZodError['issues'];

const FIXED_MESSAGES: Readonly<Record<string, string>> = {
    invalid_type: 'invalid_type',
    invalid_value: 'invalid_value',
    invalid_format: 'invalid_format',
    invalid_union: 'invalid_union',
    invalid_key: 'invalid_key',
    invalid_element: 'invalid_element',
    too_big: 'too_big',
    too_small: 'too_small',
    not_multiple_of: 'not_multiple_of',
    unrecognized_keys: 'unrecognized_keys',
    custom: 'custom',
};
const UNKNOWN_ISSUE_MESSAGE = 'invalid';

const limited = (text: string): string => text.slice(0, INVALID_PAYLOAD_TEXT_MAX_LENGTH);

export const invalidPayloadFrom = (issues: ZodIssues): AppErrorOf<'invalid_payload'> => ({
    code: 'invalid_payload',
    issues: issues.slice(0, INVALID_PAYLOAD_MAX_ISSUES).map((issue) => ({
        path: limited(issue.path.map(String).join('.')),
        message: FIXED_MESSAGES[issue.code] ?? UNKNOWN_ISSUE_MESSAGE,
    })),
});
