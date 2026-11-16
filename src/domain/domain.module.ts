import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { RandomRoomCodeGenerator, RoomCodeGenerator } from './room-code';
import { RoomRepository, SERVER_INSTANCE_ID } from './room.repository';
import { RoomService } from './room.service';

@Module({
    providers: [
        { provide: Clock, useClass: SystemClock },
        { provide: RoomCodeGenerator, useClass: RandomRoomCodeGenerator },
        { provide: SERVER_INSTANCE_ID, useFactory: () => randomUUID() },
        RoomRepository,
        RoomService,
    ],
    exports: [Clock, SERVER_INSTANCE_ID, RoomRepository, RoomService],
})
export class DomainModule {}
