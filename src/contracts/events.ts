import type { z } from 'zod';
import { type AckCallback, noResultSchema } from './ack';
import {
    funReactedSchema,
    funReactPayloadSchema,
    funThrownSchema,
    funThrowPayloadSchema,
    funUmbrellaPayloadSchema,
} from './fun';
import { kiroInviteSchema } from './kiro';
import { emptyPayloadSchema } from './primitives';
import {
    roomCreatePayloadSchema,
    roomJoinPayloadSchema,
    roomSessionSchema,
    roomSetRolePayloadSchema,
    roomStateSchema,
    roomTransferFacilitatorPayloadSchema,
    roomUpdateSettingsPayloadSchema,
} from './room';
import {
    roundFinalizePayloadSchema,
    roundResetPayloadSchema,
    roundRevealPayloadSchema,
    roundVotePayloadSchema,
} from './round';
import { rouletteSpinPayloadSchema, rouletteSpunSchema } from './roulette';

export const EVENT_AREAS = ['room', 'round', 'roulette', 'fun', 'jira', 'kiro'] as const;
export type EventArea = (typeof EVENT_AREAS)[number];
type EventName = `${EventArea}:${string}`;

type ClientEventContract = { readonly payload: z.ZodType; readonly result: z.ZodType };

export const CLIENT_EVENTS = {
    'room:create': { payload: roomCreatePayloadSchema, result: roomSessionSchema },
    'room:join': { payload: roomJoinPayloadSchema, result: roomSessionSchema },
    'room:leave': { payload: emptyPayloadSchema, result: noResultSchema },
    'room:updateSettings': { payload: roomUpdateSettingsPayloadSchema, result: noResultSchema },
    'room:transferFacilitator': { payload: roomTransferFacilitatorPayloadSchema, result: noResultSchema },
    'room:setRole': { payload: roomSetRolePayloadSchema, result: noResultSchema },
    'round:vote': { payload: roundVotePayloadSchema, result: noResultSchema },
    'round:reveal': { payload: roundRevealPayloadSchema, result: noResultSchema },
    'round:reset': { payload: roundResetPayloadSchema, result: noResultSchema },
    'round:finalize': { payload: roundFinalizePayloadSchema, result: noResultSchema },
    'fun:throw': { payload: funThrowPayloadSchema, result: noResultSchema },
    'fun:umbrella': { payload: funUmbrellaPayloadSchema, result: noResultSchema },
    'fun:react': { payload: funReactPayloadSchema, result: noResultSchema },
    'roulette:spin': { payload: rouletteSpinPayloadSchema, result: noResultSchema },
    'kiro:invite': { payload: emptyPayloadSchema, result: kiroInviteSchema },
} as const satisfies Record<EventName, ClientEventContract>;

export type ClientEventName = keyof typeof CLIENT_EVENTS;
export type ClientEventPayload<E extends ClientEventName> = z.input<(typeof CLIENT_EVENTS)[E]['payload']>;
export type ParsedClientEventPayload<E extends ClientEventName> = z.output<(typeof CLIENT_EVENTS)[E]['payload']>;
export type ClientEventResult<E extends ClientEventName> = z.output<(typeof CLIENT_EVENTS)[E]['result']>;

export const SERVER_EVENTS = {
    'room:state': roomStateSchema,
    'fun:thrown': funThrownSchema,
    'fun:reacted': funReactedSchema,
    'roulette:spun': rouletteSpunSchema,
} as const satisfies Record<EventName, z.ZodType>;

export type ServerEventName = keyof typeof SERVER_EVENTS;
export type ServerEventPayload<E extends ServerEventName> = z.output<(typeof SERVER_EVENTS)[E]>;

export type ClientToServerEvents = {
    [E in ClientEventName]: (payload: ClientEventPayload<E>, ack: AckCallback<ClientEventResult<E>>) => void;
};

export type ServerToClientEvents = {
    [E in ServerEventName]: (payload: ServerEventPayload<E>) => void;
};
