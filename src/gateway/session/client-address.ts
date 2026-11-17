import { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { CLIENT_ADDRESS_MAX_LENGTH } from './limits';

export const TRUSTED_PROXY_HOPS_ENV = 'TRUSTED_PROXY_HOPS';
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
export const MAX_TRUSTED_PROXY_HOPS = 5;
const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const UNKNOWN_ADDRESS = 'unknown';
const HOPS_PATTERN = /^\d{1,2}$/;

const logger = new Logger('ClientAddress');

export const parseTrustedProxyHops = (
    raw: string | undefined,
    warn: (message: string) => void = (message) => logger.warn(message),
): number => {
    const value = raw?.trim();
    if (!value) return DEFAULT_TRUSTED_PROXY_HOPS;
    const hops = HOPS_PATTERN.test(value) ? Number(value) : Number.NaN;
    if (hops >= 0 && hops <= MAX_TRUSTED_PROXY_HOPS) return hops;
    warn(
        `${TRUSTED_PROXY_HOPS_ENV} must be an integer from 0 to ${MAX_TRUSTED_PROXY_HOPS}; using ${DEFAULT_TRUSTED_PROXY_HOPS}`,
    );
    return DEFAULT_TRUSTED_PROXY_HOPS;
};

let configuredHops: { raw: string | undefined; hops: number } = {
    raw: undefined,
    hops: DEFAULT_TRUSTED_PROXY_HOPS,
};

const trustedProxyHops = (): number => {
    const raw = process.env[TRUSTED_PROXY_HOPS_ENV];
    if (configuredHops.raw !== raw) configuredHops = { raw, hops: parseTrustedProxyHops(raw) };
    return configuredHops.hops;
};

const forwardedEntryFromRight = (forwardedFor: string | string[] | undefined, hops: number): string | undefined => {
    if (hops === 0 || forwardedFor === undefined) return undefined;
    const entries = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor).split(',');
    const entry = entries.at(-hops)?.trim();
    return entries.length >= hops && entry && isIP(entry) !== 0 ? entry : undefined;
};

export const resolveClientAddress = (
    forwardedFor: string | string[] | undefined,
    socketAddress: string | undefined,
    hops: number = trustedProxyHops(),
): string =>
    (forwardedEntryFromRight(forwardedFor, hops) ?? socketAddress ?? UNKNOWN_ADDRESS).slice(
        0,
        CLIENT_ADDRESS_MAX_LENGTH,
    );

export const clientAddressOf = ({ handshake }: Pick<Socket, 'handshake'>): string =>
    resolveClientAddress(handshake.headers[FORWARDED_FOR_HEADER], handshake.address);

export const clientAddressOfRequest = ({ headers, socket }: Pick<IncomingMessage, 'headers' | 'socket'>): string =>
    resolveClientAddress(headers[FORWARDED_FOR_HEADER], socket.remoteAddress);
