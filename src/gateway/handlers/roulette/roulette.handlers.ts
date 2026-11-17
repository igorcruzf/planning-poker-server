import { Injectable } from '@nestjs/common';
import { RouletteService } from '../../../roulette/roulette.service';
import { GatewayContributor, GatewayRegistry } from '../../gateway-registry';
import { ClientEventRunner } from '../../session/client-event-runner';

@Injectable()
export class RouletteHandlers implements GatewayContributor {
    constructor(
        private readonly roulette: RouletteService,
        private readonly runner: ClientEventRunner,
    ) {}

    register(registry: GatewayRegistry): void {
        registry.on('roulette:spin', (payload, { socket }) =>
            this.runner.run('roulette:spin', payload, socket, (request) => {
                socket.emit('roulette:spun', this.roulette.spin(request));
                return null;
            }),
        );
    }
}
