import { GatewayMetadata } from '@nestjs/websockets';
import { corsOrigin } from '../cors-origin';

const MAX_HTTP_BUFFER_SIZE_BYTES = 16 * 1024;

export const gatewayOptions = (): GatewayMetadata => ({
    cors: { origin: corsOrigin() },
    maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE_BYTES,
});
