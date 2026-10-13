import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { resolveArcadeMissionObjectiveLabel } from '../src/ui/arcade/ArcadeMissionHUD.js';

test('arcade sector objectives show German names to the player', () => {
    assert.equal(resolveArcadeMissionObjectiveLabel({ objectiveId: 'clean_sector', label: 'Clean Sector' }), 'Sektor säubern');
    assert.equal(resolveArcadeMissionObjectiveLabel({ objectiveId: 'bounty_hunt', label: 'Bounty Hunt' }), 'Kopfgeldjagd');
    assert.equal(resolveArcadeMissionObjectiveLabel({ objectiveId: 'hazard_lane', label: 'Hazard Lane' }), 'Gefahrenschneise');
    assert.equal(resolveArcadeMissionObjectiveLabel({ objectiveId: 'survive_window', label: 'Survive Window' }), 'Überleben');
});

test('portal layout notices and the exclusion zone stage speak German', () => {
    const portal = fs.readFileSync('src/entities/arena/portal/PortalLayoutBuilder.js', 'utf8');
    assert.doesNotMatch(portal, /Portal pair was skipped/);
    for (const file of ['src/ui/HUD.js', 'src/ui/four-player-planar/ThreePlayerSplitHudView.js']) {
        assert.match(fs.readFileSync(file, 'utf8'), /WEAK: 'SCHWACH', MEDIUM: 'MITTEL', HEAVY: 'SCHWER'/, file);
    }
});

test('the pause card sits above the HUD top bar', () => {
    const css = fs.readFileSync('src/ui/menu/MenuPause.css', 'utf8');
    assert.match(css, /\.menu-q-pause \{[^}]*z-index: 110;/);
});
