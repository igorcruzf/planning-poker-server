import { z } from 'zod';

export const SECRET_TOKEN_BYTES = 32;
export const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const secretTokenSchema = z.string().regex(SECRET_TOKEN_PATTERN);
export type SecretToken = z.infer<typeof secretTokenSchema>;

export const sessionTokenSchema = secretTokenSchema;
export type SessionToken = z.infer<typeof sessionTokenSchema>;

export const emptyPayloadSchema = z.strictObject({});
export type EmptyPayload = z.infer<typeof emptyPayloadSchema>;

export const ROOM_LINK_QUERY_PARAM = 'mesa';
export const ROOM_CODE_PREFIX = 'yak-';
export const ROOM_CODE_SUFFIX_LENGTH = 8;
export const ROOM_CODE_SUFFIX_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ROOM_CODE_ACCEPTED_SUFFIX_LENGTH = { min: 4, max: 16 };
export const ROOM_CODE_PATTERN = new RegExp(
    `^${ROOM_CODE_PREFIX}[a-z0-9]{${ROOM_CODE_ACCEPTED_SUFFIX_LENGTH.min},${ROOM_CODE_ACCEPTED_SUFFIX_LENGTH.max}}$`,
);
export const roomCodeSchema = z.string().trim().toLowerCase().regex(ROOM_CODE_PATTERN);
export type RoomCode = z.infer<typeof roomCodeSchema>;

export const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const participantIdSchema = z.string().regex(PARTICIPANT_ID_PATTERN);
export type ParticipantId = z.infer<typeof participantIdSchema>;

export const SERVER_INSTANCE_ID_MAX_LENGTH = 64;
export const serverInstanceIdSchema = z.string().min(1).max(SERVER_INSTANCE_ID_MAX_LENGTH);
export type ServerInstanceId = z.infer<typeof serverInstanceIdSchema>;

export const timestampSchema = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof timestampSchema>;

export const durationMsSchema = z.number().int().nonnegative();

export const PERSON_NAME_MAX_LENGTH = 30;
export const ROOM_NAME_MAX_LENGTH = 30;
const FORBIDDEN_CHARACTER = /(?![\u200C\u200D])[\p{Cc}\p{Cf}]/u;

const INVISIBLE_CODE_POINTS = new Set([0x200c, 0x200d, 0x3164, 0x2800, 0x115f, 0x1160, 0x17b4, 0x17b5, 0xffa0]);
const WHITESPACE = /\s/u;
const hasVisibleCharacter = (text: string) =>
    [...text].some((character) => !WHITESPACE.test(character) && !INVISIBLE_CODE_POINTS.has(character.codePointAt(0)!));

export const boundedTextSchema = (maxLength: number) =>
    z
        .string()
        .trim()
        .min(1)
        .max(maxLength)
        .refine((text) => !FORBIDDEN_CHARACTER.test(text), { message: 'Control and formatting characters are not allowed' })
        .refine(hasVisibleCharacter, { message: 'At least one visible character is required' });

export const personNameSchema = boundedTextSchema(PERSON_NAME_MAX_LENGTH);
export type PersonName = z.infer<typeof personNameSchema>;

export const roomNameSchema = boundedTextSchema(ROOM_NAME_MAX_LENGTH);
export type RoomName = z.infer<typeof roomNameSchema>;

const hasNoCredentials = (url: string) => {
    if (!URL.canParse(url)) return false;
    const { username, password } = new URL(url);
    return !username && !password;
};
export const httpUrlSchema = z
    .url({ protocol: /^https?$/ })
    .refine(hasNoCredentials, { message: 'URL must not contain credentials' });

export const deepFreeze = <T>(value: T): T => {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
};
export const hasUniqueItems = (items: readonly unknown[]) => new Set(items).size === items.length;
