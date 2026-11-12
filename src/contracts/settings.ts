import { z } from 'zod';
import { DEFAULT_DECK, deckSchema, deckStateSchema, SPECIAL_CARDS, specialCardSchema } from './deck';
import { hasUniqueItems } from './primitives';

export const COUNTDOWN_SECONDS_OPTIONS = [0, 3, 5] as const;
export const countdownSecondsSchema = z.literal(COUNTDOWN_SECONDS_OPTIONS);
export type CountdownSeconds = z.infer<typeof countdownSecondsSchema>;

export const specialCardsSettingSchema = z
    .array(specialCardSchema)
    .max(SPECIAL_CARDS.length)
    .refine(hasUniqueItems, { message: 'Special cards must be unique' });

const roomSettingsFields = {
    deck: deckSchema,
    specialCards: specialCardsSettingSchema,
    autoReveal: z.boolean(),
    countdownSeconds: countdownSecondsSchema,
    allowSpectators: z.boolean(),
    allowKiro: z.boolean(),
    kiroCountsAsPlayer: z.boolean(),
    jiraLinked: z.boolean(),
    jiraCommentOnSave: z.boolean(),
};

export const roomSettingsSchema = z.strictObject(roomSettingsFields);
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
    deck: DEFAULT_DECK,
    specialCards: [...SPECIAL_CARDS],
    autoReveal: false,
    countdownSeconds: 3,
    allowSpectators: true,
    allowKiro: false,
    kiroCountsAsPlayer: false,
    jiraLinked: false,
    jiraCommentOnSave: false,
};

export const roomSettingsInputSchema = z.strictObject({
    deck: roomSettingsFields.deck.default(DEFAULT_ROOM_SETTINGS.deck),
    specialCards: roomSettingsFields.specialCards.default(DEFAULT_ROOM_SETTINGS.specialCards),
    autoReveal: roomSettingsFields.autoReveal.default(DEFAULT_ROOM_SETTINGS.autoReveal),
    countdownSeconds: roomSettingsFields.countdownSeconds.default(DEFAULT_ROOM_SETTINGS.countdownSeconds),
    allowSpectators: roomSettingsFields.allowSpectators.default(DEFAULT_ROOM_SETTINGS.allowSpectators),
    allowKiro: roomSettingsFields.allowKiro.default(DEFAULT_ROOM_SETTINGS.allowKiro),
    kiroCountsAsPlayer: roomSettingsFields.kiroCountsAsPlayer.default(DEFAULT_ROOM_SETTINGS.kiroCountsAsPlayer),
    jiraLinked: roomSettingsFields.jiraLinked.default(DEFAULT_ROOM_SETTINGS.jiraLinked),
    jiraCommentOnSave: roomSettingsFields.jiraCommentOnSave.default(DEFAULT_ROOM_SETTINGS.jiraCommentOnSave),
});
export type RoomSettingsInput = z.input<typeof roomSettingsInputSchema>;

export const roomSettingsPatchSchema = roomSettingsSchema
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one setting' });
export type RoomSettingsPatch = z.infer<typeof roomSettingsPatchSchema>;

export const roomSettingsStateSchema = z.object({
    ...roomSettingsFields,
    deck: deckStateSchema,
    specialCards: z.array(specialCardSchema),
});
export type RoomSettingsState = z.infer<typeof roomSettingsStateSchema>;
