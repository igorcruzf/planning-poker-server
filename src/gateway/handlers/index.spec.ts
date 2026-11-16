import { gatewayAreas } from './index';

const AREAS = ['room', 'round', 'roulette', 'fun', 'jira', 'kiro'];

describe('gatewayAreas', () => {
    it('aggregates exactly the six areas', () => {
        expect(gatewayAreas.map((area) => area.name)).toEqual(AREAS);
    });

    it.each(AREAS)('starts the %s area empty', (name) => {
        const area = gatewayAreas.find((candidate) => candidate.name === name);
        expect(area?.contributors).toEqual([]);
        expect(area?.module.imports).toEqual([]);
        expect(area?.module.providers).toEqual([]);
        expect(area?.module.exports).toEqual([]);
    });
});
