import { Socket } from 'socket.io';
import { CLIENT_ADDRESS_MAX_LENGTH } from './limits';

const FORWARDED_FOR_HEADER = 'x-forwarded-for';

export const clientAddressOf = ({ handshake }: Pick<Socket, 'handshake'>): string => {
    const forwarded = handshake.headers[FORWARDED_FOR_HEADER];
    const closestProxyEntry = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
        .split(',')
        .pop()
        ?.trim();
    return (closestProxyEntry || handshake.address).slice(0, CLIENT_ADDRESS_MAX_LENGTH);
};
