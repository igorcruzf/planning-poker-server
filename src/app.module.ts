import { Module } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { HealthModule } from './health/health.module';
import { PlanningPokerState } from './planning-poker.state';

@Module({
    imports: [HealthModule],
    providers: [AppGateway, PlanningPokerState],
})
export class AppModule {}
