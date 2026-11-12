import { DynamicModule, ModuleMetadata, Provider, Type } from '@nestjs/common';
import { GatewayContributor } from './gateway-registry';

export interface GatewayAreaDefinition {
    readonly name: string;
    readonly imports?: NonNullable<ModuleMetadata['imports']>;
    readonly providers?: Provider[];
    readonly contributors?: Type<GatewayContributor>[];
}

export interface GatewayArea {
    readonly name: string;
    readonly module: DynamicModule;
    readonly contributors: readonly Type<GatewayContributor>[];
}

const createAreaModuleClass = (name: string): Type<unknown> => {
    const areaModule = class {};
    Object.defineProperty(areaModule, 'name', { value: `GatewayArea[${name}]` });
    return areaModule;
};

export const defineGatewayArea = ({
    name,
    imports = [],
    providers = [],
    contributors = [],
}: GatewayAreaDefinition): GatewayArea => {
    if (name.trim().length === 0) {
        throw new Error('Gateway area name must not be blank');
    }
    return {
        name,
        contributors: [...contributors],
        module: {
            module: createAreaModuleClass(name),
            imports: [...imports],
            providers: [...providers, ...contributors],
            exports: [...contributors],
        },
    };
};
