import { z } from 'zod';
import { jiraRoomStateSchema } from './jira';
import {
    participantIdSchema,
    personNameSchema,
    roomCodeSchema,
    roomNameSchema,
    serverInstanceIdSchema,
    sessionTokenSchema,
    timestampSchema,
} from './primitives';
import { historyEntrySchema, roundStateSchema } from './round';
import { roomSettingsInputSchema, roomSettingsPatchSchema, roomSettingsStateSchema } from './settings';

export const ROOM_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
export const DISCONNECTED_PLAYER_GRACE_MS = 30 * 1000;

export const participantRoleSchema = z.enum(['player', 'spectator', 'bot']);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

export const humanRoleSchema = participantRoleSchema.exclude(['bot']);
export type HumanRole = z.infer<typeof humanRoleSchema>;

export const presenceSchema = z.enum(['connected', 'disconnected']);
export type Presence = z.infer<typeof presenceSchema>;

export const roomCreatePayloadSchema = z.strictObject({
    roomName: roomNameSchema,
    participantName: personNameSchema,
    settings: roomSettingsInputSchema.prefault({}),
});
export type RoomCreatePayload = z.infer<typeof roomCreatePayloadSchema>;

export const roomJoinPayloadSchema = z.strictObject({
    roomCode: roomCodeSchema,
    name: personNameSchema,
    role: humanRoleSchema.default('player'),
    sessionToken: sessionTokenSchema.optional(),
});
export type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>;

export const roomSessionSchema = z.object({
    roomCode: roomCodeSchema,
    participantId: participantIdSchema,
    sessionToken: sessionTokenSchema,
});
export type RoomSession = z.infer<typeof roomSessionSchema>;

export const roomUpdateSettingsPayloadSchema = roomSettingsPatchSchema;
export type RoomUpdateSettingsPayload = z.infer<typeof roomUpdateSettingsPayloadSchema>;

export const roomTransferFacilitatorPayloadSchema = z.strictObject({ participantId: participantIdSchema });
export type RoomTransferFacilitatorPayload = z.infer<typeof roomTransferFacilitatorPayloadSchema>;

export const roomSetRolePayloadSchema = z.strictObject({ role: humanRoleSchema });
export type RoomSetRolePayload = z.infer<typeof roomSetRolePayloadSchema>;

const participantStateFields = {
    id: participantIdSchema,
    name: z.string(),
    isFacilitator: z.boolean(),
    presence: presenceSchema,
    hasVoted: z.boolean(),
    umbrella: z.boolean(),
};

export const humanParticipantStateSchema = z.object({ ...participantStateFields, role: humanRoleSchema });
export type HumanParticipantState = z.infer<typeof humanParticipantStateSchema>;

export const botParticipantStateSchema = z.object({
    ...participantStateFields,
    role: z.literal('bot'),
    ownerId: participantIdSchema,
});
export type BotParticipantState = z.infer<typeof botParticipantStateSchema>;

export const participantStateSchema = z.discriminatedUnion('role', [
    humanParticipantStateSchema,
    botParticipantStateSchema,
]);
export type ParticipantState = z.infer<typeof participantStateSchema>;

export const roomStateSchema = z.object({
    serverInstanceId: serverInstanceIdSchema,
    room: z.object({ code: roomCodeSchema, name: z.string(), createdAt: timestampSchema }),
    settings: roomSettingsStateSchema,
    participants: z.array(participantStateSchema),
    round: roundStateSchema,
    history: z.array(historyEntrySchema),
    jira: jiraRoomStateSchema.nullable(),
    self: z.object({ participantId: participantIdSchema, vote: z.string().nullable() }),
});
export type RoomState = z.infer<typeof roomStateSchema>;
