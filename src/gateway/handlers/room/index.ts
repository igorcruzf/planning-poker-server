import { DomainModule } from '../../../domain/domain.module';
import { defineGatewayArea } from '../../gateway-area';
import { SessionModule } from '../../session/session.module';
import { ConnectionHandlers } from './connection.handlers';
import { RoomHandlers } from './room.handlers';

export const roomArea = defineGatewayArea({
    name: 'room',
    imports: [DomainModule, SessionModule],
    contributors: [ConnectionHandlers, RoomHandlers],
});
