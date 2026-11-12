import { GatewayMetadata } from '@nestjs/websockets';
import { corsOrigin } from '../cors-origin';

const SOCKET_IO_DEFAULT_MAX_HTTP_BUFFER_SIZE = 1_000_000;

export const gatewayOptions = (): GatewayMetadata => ({
    cors: { origin: corsOrigin() },
    maxHttpBufferSize: SOCKET_IO_DEFAULT_MAX_HTTP_BUFFER_SIZE,
});
