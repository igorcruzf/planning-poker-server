import { z } from 'zod';
import { protocolVersionErrorSchema } from './errors';

export const PROTOCOL_VERSION = '1.0';
export const PROTOCOL_VERSION_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
export const protocolVersionSchema = z.string().regex(PROTOCOL_VERSION_PATTERN);

export const handshakeAuthSchema = z.strictObject({ protocolVersion: protocolVersionSchema });
export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>;

export const connectErrorDataSchema = protocolVersionErrorSchema;
export type ConnectErrorData = z.infer<typeof connectErrorDataSchema>;
