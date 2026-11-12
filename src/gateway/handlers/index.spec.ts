import { gatewayAreas } from './index';

const NEW_AREAS = ['room', 'round', 'roulette', 'fun', 'jira', 'kiro'];

describe('gatewayAreas', () => {
    it('aggregates exactly the legacy area and the six new areas', () => {
        expect(gatewayAreas.map((area) => area.name)).toEqual(['legacy', ...NEW_AREAS]);
    });

    it.each(NEW_AREAS)('starts the %s area empty', (name) => {
        const area = gatewayAreas.find((candidate) => candidate.name === name);

        expect(area?.contributors).toEqual([]);
        expect(area?.module.imports).toEqual([]);
        expect(area?.module.providers).toEqual([]);
        expect(area?.module.exports).toEqual([]);
    });

    it('keeps the legacy events in the legacy area', () => {
        const legacy = gatewayAreas.find((area) => area.name === 'legacy');

        expect(legacy?.contributors.map((contributor) => contributor.name)).toEqual(['LegacyHandlers']);
    });
});
