import { GatewayArea } from '../gateway-area';
import { funArea } from './fun';
import { jiraArea } from './jira';
import { kiroArea } from './kiro';
import { roomArea } from './room';
import { rouletteArea } from './roulette';
import { roundArea } from './round';
export const gatewayAreas: readonly GatewayArea[] = [roomArea, roundArea, rouletteArea, funArea, jiraArea, kiroArea];
