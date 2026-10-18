import { generateEndlessParcoursModule } from './EndlessParcoursGenerator.js';
import { EndlessParcoursPathMetric } from './EndlessParcoursPathMetric.js';
import { resolveEndlessAreaBlock, resolveEndlessAreaTier } from '../../shared/contracts/EndlessParcoursPacingContract.js';

/**
 * Haelt den Kettenzustand der Strecke. Weil sich der Korridorversatz aufsummiert
 * und die Erholungsgarantie zaehlt, ist die Kette - nicht der einzelne Index -
 * die Wahrheit ueber den Verlauf.
 *
 * Tier und Gebiet entstehen aus der tatsaechlichen Laenge aller Vorgaenger.
 * Vorschau und Flugzeit koennen einen spaeter erneut geladenen Abschnitt nicht
 * veraendern; die Kette speichert ihren Ausgangszustand beim ersten Erzeugen.
 */
export class EndlessParcoursPath {
    constructor({ baseSeed = 1 } = {}) {
        this.baseSeed = Math.max(1, Number(baseSeed) >>> 0);
        /** @type {{ entranceConnector: string, driftX: number, driftY: number, sinceRecovery: number, tier: number, startS: number, areaBlock: number, previousTemplateId: string, previousArea: string }[]} */
        this._chain = [];
        this._metric = new EndlessParcoursPathMetric();
    }

    /**
     * @param {unknown} index
     */
    getModule(index) {
        const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
        this._ensureChain(safeIndex);
        return this._buildAt(safeIndex);
    }

    getChainLength() {
        return this._chain.length;
    }

    getMetric() { return this._metric; }

    dispose() { this._chain.length = 0; this._metric.clear(); }

    _buildAt(index) {
        const state = this._chain[index];
        const module = generateEndlessParcoursModule({
            baseSeed: this.baseSeed,
            moduleIndex: index,
            previousConnector: state.entranceConnector,
            entryDrift: { x: state.driftX, y: state.driftY },
            difficultyTier: state.tier,
            areaBlock: state.areaBlock,
            sinceRecovery: state.sinceRecovery,
            previousTemplateId: state.previousTemplateId,
            previousArea: state.previousArea,
        });
        if (this._metric.getModuleCount() <= index) this._metric.appendModule(module);
        return module;
    }

    _ensureChain(index) {
        if (this._chain.length === 0) {
            this._chain.push({
                entranceConnector: 'straight',
                driftX: 0,
                driftY: 0,
                sinceRecovery: 0,
                tier: 1,
                startS: 0,
                areaBlock: -1,
                previousTemplateId: '',
                previousArea: '',
            });
        }
        while (this._chain.length <= index) {
            const previous = this._buildAt(this._chain.length - 1);
            const previousState = this._chain[this._chain.length - 1];
            const startS = this._metric.totalLength;
            const areaBlock = resolveEndlessAreaBlock(startS, this._metric.getStationRange(0).endS);
            this._chain.push({
                entranceConnector: previous.exitConnector,
                driftX: previous.exitDrift.x,
                driftY: previous.exitDrift.y,
                sinceRecovery: previous.recovery || previous.templateId === 'combat_free_intro'
                    ? 0
                    : previousState.sinceRecovery + 1,
                tier: resolveEndlessAreaTier(areaBlock),
                startS,
                areaBlock,
                previousTemplateId: previous.templateId,
                previousArea: previous.area,
            });
        }
    }
}
