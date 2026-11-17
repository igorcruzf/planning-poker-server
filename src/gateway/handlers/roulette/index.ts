import { RouletteModule } from '../../../roulette/roulette.module';
import { defineGatewayArea } from '../../gateway-area';
import { SessionModule } from '../../session/session.module';
import { RouletteHandlers } from './roulette.handlers';

export const rouletteArea = defineGatewayArea({
    name: 'roulette',
    imports: [RouletteModule, SessionModule],
    contributors: [RouletteHandlers],
});
