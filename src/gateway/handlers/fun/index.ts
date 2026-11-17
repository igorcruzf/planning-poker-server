import { DomainModule } from '../../../domain/domain.module';
import { defineGatewayArea } from '../../gateway-area';
import { SessionModule } from '../../session/session.module';
import { FunHandlers } from './fun.handlers';

export const funArea = defineGatewayArea({
    name: 'fun',
    imports: [DomainModule, SessionModule],
    contributors: [FunHandlers],
});
