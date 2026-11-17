import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JiraRoomController } from './jira-room.controller';
import { JiraRoomModule } from './jira-room.module';
import { JiraRoomService } from './jira-room.service';

@Module({ imports: [JiraRoomModule] })
class HostModule {}

describe('JiraRoomModule', () => {
    it('wires the room service and the controller to the domain and to the Jira services', async () => {
        const context = await NestFactory.createApplicationContext(HostModule, { logger: false });

        expect(context.get(JiraRoomService, { strict: false })).toBeInstanceOf(JiraRoomService);
        expect(context.get(JiraRoomController, { strict: false })).toBeInstanceOf(JiraRoomController);
        await context.close();
    });
});
