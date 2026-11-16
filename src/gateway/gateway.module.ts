import { DynamicModule, Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { GatewayArea } from './gateway-area';
import { GatewayContributor } from './gateway-registry';
import { GatewayRegistrations } from './gateway-registrations';
import { SocketGateway } from './socket.gateway';

const assertUniqueNames = (areas: readonly GatewayArea[]) => {
    const names = new Set<string>();
    areas.forEach(({ name }) => {
        if (names.has(name)) {
            throw new Error(`Gateway area "${name}" is defined twice`);
        }
        names.add(name);
    });
};

@Module({})
export class GatewayModule {
    static forAreas(areas: readonly GatewayArea[]): DynamicModule {
        assertUniqueNames(areas);
        return {
            module: GatewayModule,
            imports: [DomainModule, ...areas.map((area) => area.module)],
            providers: [
                {
                    provide: GatewayRegistrations,
                    useFactory: (...contributors: GatewayContributor[]) => GatewayRegistrations.collect(contributors),
                    inject: areas.flatMap((area) => area.contributors),
                },
                SocketGateway,
            ],
        };
    }
}
