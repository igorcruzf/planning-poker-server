import { Module } from '@nestjs/common';
import { GatewayModule } from './gateway/gateway.module';
import { gatewayAreas } from './gateway/handlers';
import { HealthModule } from './health/health.module';
import { JiraAuthModule } from './jira/auth/jira-auth.module';
import { JiraHttpModule } from './jira/http/jira-http.module';
import { JiraRoomModule } from './jira/room/jira-room.module';
import { McpModule } from './mcp/mcp.module';

@Module({
    imports: [
        HealthModule,
        GatewayModule.forAreas(gatewayAreas),
        JiraAuthModule,
        JiraHttpModule,
        JiraRoomModule,
        McpModule,
    ],
})
export class AppModule {}
