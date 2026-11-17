import { DomainModule } from '../../../domain/domain.module';
import { defineGatewayArea } from '../../gateway-area';
import { SessionModule } from '../../session/session.module';
import { RoundHandlers } from './round.handlers';

export const roundArea = defineGatewayArea({
    name: 'round',
    imports: [DomainModule, SessionModule],
    contributors: [RoundHandlers],
});
