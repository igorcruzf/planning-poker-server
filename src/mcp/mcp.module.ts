import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { SessionModule } from '../gateway/session/session.module';
import { KiroTableService } from './kiro-table.service';
import { McpController } from './mcp.controller';
import { McpSessionHub } from './mcp-session-hub';
export const MCP_PROVIDERS = [KiroTableService, McpSessionHub];
@Module({
    imports: [DomainModule, SessionModule],
    controllers: [McpController],
    providers: MCP_PROVIDERS,
})
export class McpModule {}
