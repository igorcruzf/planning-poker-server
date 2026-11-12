import { Module } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { PlanningPokerState } from './planning-poker.state';

@Module({
    providers: [AppGateway, PlanningPokerState],
})
export class AppModule {}
