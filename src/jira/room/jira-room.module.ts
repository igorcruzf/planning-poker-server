import { Module } from '@nestjs/common';
import { DomainModule } from '../../domain/domain.module';
import { JiraHttpModule } from '../http/jira-http.module';
import { JiraRoomController } from './jira-room.controller';
import { JiraRoomService } from './jira-room.service';

@Module({
    imports: [DomainModule, JiraHttpModule],
    controllers: [JiraRoomController],
    providers: [JiraRoomService],
})
export class JiraRoomModule {}
