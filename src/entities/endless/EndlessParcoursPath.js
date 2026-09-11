import { generateEndlessParcoursModule } from './EndlessParcoursGenerator.js';

/**
 * Haelt den Kettenzustand der Strecke. Weil sich der Korridorversatz aufsummiert
 * und die Erholungsgarantie zaehlt, ist die Kette - nicht der einzelne Index -
 * die Wahrheit ueber den Verlauf.
 *
 * Nebeneffekt, der ein altes Problem loest: Der Schwierigkeitsgrad eines
 * Bausteins wird beim ersten Erzeugen festgeschrieben. Vorher konnte derselbe
 * Streckenabschnitt beim erneuten Laden anders aussehen, weil in der Zwischenzeit
 * die Bedrohungsstufe gestiegen war.
 */
export class EndlessParcoursPath {
    constructor({ baseSeed = 1 } = {}) {
        this.baseSeed = Math.max(1, Number(baseSeed) >>> 0);
        /** @type {{ entranceConnector: string, driftX: number, driftY: number, sinceRecovery: number, tier: number, previousTemplateId: string, previousArea: string }[]} */
        this._chain = [];
    }

    /**
     * @param {unknown} index
     * @param {unknown} [difficultyTier]
     */
    getModule(index, difficultyTier = 1) {
        const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
        const tier = Math.max(1, Math.floor(Number(difficultyTier) || 1));
        this._ensureChain(safeIndex, tier);
        return this._buildAt(safeIndex);
    }

    getChainLength() {
        return this._chain.length;
    }

    _buildAt(index) {
        const state = this._chain[index];
        return generateEndlessParcoursModule({
            baseSeed: this.baseSeed,
            moduleIndex: index,
            previousConnector: state.entranceConnector,
            entryDrift: { x: state.driftX, y: state.driftY },
            difficultyTier: state.tier,
            sinceRecovery: state.sinceRecovery,
            previousTemplateId: state.previousTemplateId,
            previousArea: state.previousArea,
        });
    }

    _ensureChain(index, tier) {
        if (this._chain.length === 0) {
            this._chain.push({
                entranceConnector: 'straight',
                driftX: 0,
                driftY: 0,
                sinceRecovery: 0,
                tier,
                previousTemplateId: '',
                previousArea: '',
            });
        }
        while (this._chain.length <= index) {
            const previous = this._buildAt(this._chain.length - 1);
            const previousState = this._chain[this._chain.length - 1];
            this._chain.push({
                entranceConnector: previous.exitConnector,
                driftX: previous.exitDrift.x,
                driftY: previous.exitDrift.y,
                sinceRecovery: previous.recovery || previous.templateId === 'combat_free_intro'
                    ? 0
                    : previousState.sinceRecovery + 1,
                tier,
                previousTemplateId: previous.templateId,
                previousArea: previous.area,
            });
        }
    }
}
