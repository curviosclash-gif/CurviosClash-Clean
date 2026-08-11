import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Verzeichnisse statt Einzeldateien: die alte Liste hat fuenf Pfade geprueft und dabei
// eine Datei mitgezaehlt, die inzwischen nur noch ein Re-Export ist. Die eigentliche
// Lobby-Logik lag daneben und war ungeprueft.
const SCAN_TARGETS = [
    'src/network',
    'src/application/session-runtime',
    'src/entities',
    'src/modes',
    'src/core/runtime/MenuRuntimeSessionService.js',
    'src/ui/menu/MenuMultiplayerBridge.js',
];

// Pfade, die absichtlich direkt auf Uhr oder globalen Zufall zugreifen. Jeder Eintrag
// braucht einen Grund. "todo" heisst: bewertet, echte Schuld, Umbau steht aus — der
// Guard laesst sie durch, meldet sie aber sichtbar in der Zusammenfassung.
const EXCEPTIONS = {
    // Rein optisch: Partikel, Triebwerksfahnen, Deko-Streuung, Animationsphasen.
    'src/entities/Particles.js': { reason: 'visual-only particle scatter' },
    'src/entities/player/PlayerView.js': { reason: 'visual-only exhaust jitter' },
    'src/entities/arena/ArenaBuilder.js': { reason: 'visual-only decoration scatter' },
    'src/entities/Powerup.js': { reason: 'visual-only animation phase' },
    'src/entities/arena/portal/SpecialGateRuntime.js': { reason: 'visual-only animation phase' },
    'src/entities/arena/portal/CheckpointRingRuntime.js': { reason: 'visual-only animation phase' },

    // Messen echte Transport- oder Laufzeit — genau dafuer ist die Wanduhr da.
    'src/network/LatencyMonitor.js': { reason: 'measures real transport round-trip time' },
    'src/network/PeerConnectionManager.js': { reason: 'measures real heartbeat timeout' },
    'src/network/DataChannelManager.js': { reason: 'measures real channel timing' },
    'src/network/LANSignalingClient.js': { reason: 'injectable now, wall clock is the default' },
    'src/entities/ai/inference/WebSocketInferenceBridge.js': { reason: 'injectable now, wall clock is the default' },
    'src/entities/ai/ObservationBridgePolicy.js': { reason: 'measures real trainer bridge failure age' },
    'src/entities/ai/observation/ObservationSystem.js': { reason: 'measures real observation build cost' },
    'src/entities/systems/PlayerInputSystem.js': { reason: 'log throttling and real observation reuse budget' },

    // Gesetzter Wuerfel mit Rueckfall: greift nur, solange runtimeRng noch nicht steht.
    'src/entities/Trail.js': { reason: 'guarded fallback while runtimeRng is not bound yet' },
    'src/entities/Player.js': { reason: 'guarded fallback while runtimeRng is not bound yet' },

    // Erst sichtbar, seit der Guard auch blosse Verweise sieht. Alle reichen den Wuerfel
    // bzw. die Uhr als Standardwert weiter und bevorzugen die gesetzte Quelle, wenn es
    // eine gibt. Bewertet, aber echte Schuld: ohne Injektion laeuft es global.
    'src/entities/Arena.js': {
        reason: 'random is a default parameter, callers pass the seeded roll',
        todo: true,
    },
    'src/entities/Bot.js': {
        reason: 'guarded fallback while runtimeRng is not bound yet',
        todo: true,
    },
    'src/entities/runtime/EntitySetupOps.js': {
        reason: 'seeds the runtime rng and falls back to the global roll when unseeded',
        todo: true,
    },

    // Verbleibende Strategien messen Spielzeit ueber eigene Uhr-Fallbacks oder
    // reichen den Wuerfel als Standardwert weiter.
    'src/modes/ClassicModeStrategy.js': {
        reason: 'damage timestamp falls back to the wall clock when none is passed',
        todo: true,
    },
    'src/modes/HuntModeStrategy.js': {
        reason: 'nowSeconds helper plus seeded-roll fallbacks for pickup weighting',
        todo: true,
    },

    // Bewertet, aber noch nicht umgebaut.
    'src/entities/systems/ProjectileSystem.js': {
        reason: 'wall clock feeds stepProjectile simulation time',
        todo: true,
    },
    'src/entities/systems/ParcoursProgressUtils.js': {
        reason: 'wall clock feeds parcours split timing',
        todo: true,
    },
    'src/entities/arena/portal/PortalRuntimeSystem.js': {
        reason: 'lastPortalTravelAtMs reaches the match runtime projection',
        todo: true,
    },
    'src/network/OnlineMatchLobby.js': {
        reason: 'lobby ids and member timestamps still come from the wall clock',
        todo: true,
    },
    'src/network/OnlineMatchLobbyMessageRouter.js': {
        reason: 'lobby member timestamps still come from the wall clock',
        todo: true,
    },
    'src/network/LANMatchLobby.js': {
        reason: 'command ids and member timestamps still come from the wall clock',
        todo: true,
    },
    'src/application/session-runtime/NetworkLobbyServiceDiscovery.js': {
        reason: 'discovery deadline is measured against the wall clock',
        todo: true,
    },
    'src/application/session-runtime/NetworkLobbyServiceSupport.js': {
        reason: 'default host entry timestamp comes from the wall clock',
        todo: true,
    },
};

// Der alte Ausdruck verlangte die oeffnende Klammer und hat deshalb jede Zuweisung
// durchgelassen. Ein blosser Verweis ist aber genauso unbestimmt wie ein Aufruf: wer
// Math.random als Wert weiterreicht, bekommt denselben ungesetzten Wuerfel, nur eine
// Zeile spaeter.
const DIRECT_TIME_OR_RNG_PATTERN = /\b(?:Date\.now|Math\.random|performance\.now)\b/g;

// "typeof performance.now === 'function'" fragt nach der Plattform, nicht nach der Zeit.
// Solche Pruefungen sind keine Nutzung und duerfen den Guard nicht ausloesen.
const CAPABILITY_CHECK_PREFIX = /typeof\s+$/;

const toPosix = (value) => value.replace(/\\/g, '/');

// Kommentare werden durch Leerzeichen gleicher Laenge ersetzt statt entfernt, damit die
// gemeldete Zeilennummer weiter auf die echte Quelle zeigt.
export function maskComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length));
}

export function findDeterminismViolations(text) {
    const masked = maskComments(text);
    const violations = [];
    for (const match of masked.matchAll(DIRECT_TIME_OR_RNG_PATTERN)) {
        const offset = Number(match.index || 0);
        if (CAPABILITY_CHECK_PREFIX.test(masked.slice(Math.max(0, offset - 12), offset))) continue;
        const isCall = /^\s*\(/.test(masked.slice(offset + match[0].length));
        violations.push({
            line: masked.slice(0, offset).split(/\r?\n/).length,
            detail: isCall ? `${match[0]}(` : `${match[0]} (handed on as a value)`,
        });
    }
    return violations;
}

// Zeilenweise statt mit einem Gesamt-Regex: eine verschachtelte Alternative ueber die
// ganze Datei laeuft auf grossen Quellen in katastrophales Backtracking.
function isReExportOnly(text) {
    const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const code = withoutBlockComments
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//'))
        .join(' ');
    if (code.length === 0) return false;
    return /^(?:export\s*(?:\*(?:\s+as\s+\w+)?|\{[^{}]*\})\s*from\s*['"][^'"]+['"]\s*;?\s*)+$/.test(code);
}

function collectJsFiles(target) {
    const collected = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            const absolutePath = path.join(current, entry.name);
            if (entry.isDirectory()) walk(absolutePath);
            else if (entry.isFile() && /\.(?:cjs|mjs|js)$/i.test(entry.name)) collected.push(toPosix(absolutePath));
        }
    };
    if (statSync(target).isDirectory()) walk(target);
    else collected.push(toPosix(target));
    return collected;
}

export function runDeterminismGuard() {
const failures = [];
const notes = [];
const scannedFiles = [];
const exemptFiles = [];
const todoFiles = [];

// Ein gelisteter Pfad, den es nicht mehr gibt, ist ein Konfigurationsfehler und keine
// bestandene Pruefung — die alte Fassung hat ihn als "geprueft" mitgezaehlt.
for (const target of SCAN_TARGETS) {
    if (!existsSync(target)) {
        failures.push({ filePath: target, line: 1, detail: 'scan_target_not_found' });
    }
}
for (const exceptionPath of Object.keys(EXCEPTIONS)) {
    if (!existsSync(exceptionPath)) {
        failures.push({ filePath: exceptionPath, line: 1, detail: 'exception_target_not_found' });
    }
}

for (const target of SCAN_TARGETS) {
    if (!existsSync(target)) continue;
    for (const filePath of collectJsFiles(target)) {
        const exception = EXCEPTIONS[filePath];
        if (exception) {
            exemptFiles.push(filePath);
            if (exception.todo) todoFiles.push({ filePath, reason: exception.reason });
            continue;
        }

        const text = readFileSync(filePath, 'utf8');

        // Eine Datei, die nur weiterreicht, enthaelt keine Logik. Sie zaehlt deshalb
        // nicht als geprueft — sonst behauptet der Guard Abdeckung, die er nicht hat.
        if (isReExportOnly(text)) {
            notes.push(`${filePath}: re-export shell, its logic must be covered by a scanned directory`);
            continue;
        }

        scannedFiles.push(filePath);
        for (const violation of findDeterminismViolations(text)) {
            failures.push({ filePath, line: violation.line, detail: violation.detail });
        }
    }
}

if (failures.length > 0) {
    console.error('Runtime determinism guard failed.');
    for (const failure of failures) {
        console.error(`- ${failure.filePath}:${failure.line} ${failure.detail}`);
    }
    return { status: 1, failures, scannedFiles, exemptFiles, todoFiles, notes };
}

console.log('Runtime determinism guard passed.');
console.log(`Files checked: ${scannedFiles.length} (exempt: ${exemptFiles.length}, of those open todo: ${todoFiles.length})`);
for (const note of notes) {
    console.log(`- note: ${note}`);
}
for (const todo of todoFiles) {
    console.log(`- todo: ${todo.filePath} (${todo.reason})`);
}
return { status: 0, failures, scannedFiles, exemptFiles, todoFiles, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(runDeterminismGuard().status);
}
