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
export const ROOM_CODE_PATTERN = /^yak-[a-z0-9]{4,16}$/;
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
const CONTROL_CHARACTER = /\p{Cc}/u;

export const boundedTextSchema = (maxLength: number) =>
    z
        .string()
        .trim()
        .min(1)
        .max(maxLength)
        .refine((text) => !CONTROL_CHARACTER.test(text), { message: 'Control characters are not allowed' });

export const personNameSchema = boundedTextSchema(PERSON_NAME_MAX_LENGTH);
export type PersonName = z.infer<typeof personNameSchema>;

export const roomNameSchema = boundedTextSchema(ROOM_NAME_MAX_LENGTH);
export type RoomName = z.infer<typeof roomNameSchema>;

export const httpUrlSchema = z.url({ protocol: /^https?$/ });

export const hasUniqueItems = (items: readonly unknown[]) => new Set(items).size === items.length;
