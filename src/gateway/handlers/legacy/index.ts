import { PlanningPokerState } from '../../../planning-poker.state';
import { defineGatewayArea } from '../../gateway-area';
import { LegacyHandlers } from './legacy.handlers';

export const legacyArea = defineGatewayArea({
    name: 'legacy',
    providers: [PlanningPokerState],
    contributors: [LegacyHandlers],
});
