import { DomainModule } from '../../../domain/domain.module';
import { defineGatewayArea } from '../../gateway-area';
import { SessionModule } from '../../session/session.module';
import { KiroHandlers } from './kiro.handlers';
import { KIRO_MCP_URL, resolveMcpUrl } from './mcp-url';
export const kiroArea = defineGatewayArea({
    name: 'kiro',
    imports: [DomainModule, SessionModule],
    providers: [{ provide: KIRO_MCP_URL, useFactory: () => resolveMcpUrl(process.env) }],
    contributors: [KiroHandlers],
});
