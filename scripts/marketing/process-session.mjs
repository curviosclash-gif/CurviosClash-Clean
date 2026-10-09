import { exportSessionMedia } from './export-session-media.mjs';
import { checkCameraVisibility } from '../../src/core/recording/MarketingCameraQuality.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeSession, loadCandidateReplay } from './session-analysis.mjs';
import { run, root, electron, ffmpeg, hashBuild, hashFile, sourceDecodeArgs } from './session-tools.mjs';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2), { flag: 'wx' });
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function explainRejection(reason) {
    const messages = {
        incomplete_or_unverified_session: 'Die Sitzung ist unvollständig oder als technische Testaufnahme gekennzeichnet.',
        incomplete_session_raw_data_retained: 'Die Aufnahme wurde nicht vollständig abgeschlossen. Die Rohdaten bleiben erhalten.',
        insufficient_preroll: 'Vor dem Kampf fehlen zwei Minuten aktive Spielzeit derselben Runde.',
        participant_count_mismatch: 'Die aufgezeichneten Teilnehmer stimmen nicht mit der gewählten Besetzung überein.',
        physical_input_unverified: 'Für mindestens einen menschlichen Spieler fehlen nachvollziehbare eigene Eingaben.',
        no_applied_input: 'Mindestens ein menschlicher Spieler hat keine aktive Steuerung geliefert.',
        unverified_input_source: 'Die Herkunft mindestens einer Steuerung ist nicht eindeutig nachvollziehbar.',
        pause_or_missing_resolution: 'Der Abschnitt enthält eine Pause oder keine vollständig aufgezeichnete Auflösung.',
        pause_in_selected_interval: 'Der gewählte Abschnitt ist nicht durchgehend spielbar aufgezeichnet.',
        one_sided_fight: 'Der gegenseitige Schaden ist für die gewünschte ausgeglichene Szene zu einseitig.',
        missing_rocket_or_pickup: 'Eine passende Itemaufnahme oder ein erfolgreicher Raketenabschuss fehlt.',
        no_measured_reversal: 'Es ist kein ausreichend deutlicher Wechsel des Gesundheitsvorteils belegt.',
        elimination_not_attributed_to_opponent: 'Die Eliminierung lässt sich nicht dem gefilmten Gegner zuordnen.',
        third_party_damage: 'Ein weiterer Teilnehmer greift mit Schaden in den Zweikampf ein.',
        captions_overlap_or_too_fast: 'Die belegbaren Texteinblendungen würden sich überlappen oder zu schnell wechseln.',
        no_complete_fight_with_reversal: 'Kein vollständiger passender Kampf mit belegter Wendung wurde gefunden.',
        recorded_build_changed: 'Die Spielversion hat sich seit der Aufnahme geändert. Der ursprüngliche Aufnahme-Build wird benötigt.',
        original_media_changed: 'Die Originalaufnahme stimmt nicht mehr mit ihrer gespeicherten Prüfsumme überein.',
        journal_integrity_failed: 'Das Ereignisjournal wurde verändert oder beschädigt.',
        journal_incomplete: 'Das Ereignisjournal ist unvollständig.',
        replay_sample_gap: 'Die Replay-Daten enthalten eine zu große zeitliche Lücke.',
        replay_resolution_missing: 'Das Ende des ausgewählten Geschehens fehlt in den Replay-Daten.',
        key_action_not_visible: 'Mindestens eine Schlüsselaktion ist verdeckt, zu klein oder außerhalb des Bildes.',
        subjects_obscured_or_offscreen: 'Die Kontrahenten sind zu oft verdeckt oder außerhalb des Bildes.',
        camera_jump: 'Die Kamerafahrt enthält einen zu großen Sprung.',
        camera_acceleration: 'Die Kamerabewegung ändert sich zu abrupt.',
        black_or_frozen_frames: 'Das Ergebnis enthält zu lange Schwarz- oder Standbilder.',
        audio_silent_clipped_or_unmeasurable: 'Der Ton ist zu leise, übersteuert oder nicht zuverlässig messbar.',
        export_metadata_failed: 'Bildformat, Bildrate oder Tonlänge entsprechen nicht den Exportvorgaben.',
        analysis_size_limit: 'Die Ereignismenge überschreitet die Grenze der automatischen Auswertung.',
    };
    return messages[String(reason).split(':')[0]] || 'Eine technische Prüfung ist fehlgeschlagen. Einzelheiten stehen in result.json.';
}

export function checkCameraSamples(samples) {
    const failures = [];
    if (!Array.isArray(samples) || samples.length < 2) return ['camera_evidence_missing'];
    for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1], b = samples[index];
        const distance = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z);
        const dot = Math.abs(['x', 'y', 'z', 'w'].reduce((sum, key) => sum + a.quaternion[key] * b.quaternion[key], 0));
        const angle = 2 * Math.acos(Math.min(1, dot));
        if (![distance, angle, b.fov].every(Number.isFinite) || distance > 1.7 || angle > 0.08 || Math.abs(b.fov - a.fov) > 1.5) {
            failures.push(`camera_jump:${index}`);
        }
        if (index > 1) {
            const previous = samples[index - 2];
            const acceleration = Math.hypot(...['x', 'y', 'z'].map((key) => b.position[key] - 2 * a.position[key] + previous.position[key]));
            if (!Number.isFinite(acceleration) || acceleration > 0.5) failures.push(`camera_acceleration:${index}`);
        }
    }
    return failures;
}

export async function processSession(directory) {
    console.log('Prüfe Originalaufnahme, Ereignisse und mögliche Kampfszenen …');
    const manifest = await json(path.join(directory, 'session.json'));
    const output = path.join(directory, `production-${stamp()}`);
    await mkdir(output);
    const result = { status: 'rejected', modelCalls: 0, candidates: [], reasons: [], directory: output };
    try {
        if (manifest.status !== 'complete') throw new Error('incomplete_session_raw_data_retained');
        if (await hashFile(path.join(directory, 'original.webm')) !== manifest.mediaSha256) throw new Error('original_media_changed');
        const sourceDecode = await run(ffmpeg, sourceDecodeArgs(path.join(directory, 'original.webm')));
        if (sourceDecode.stderr.trim()) throw new Error('original_media_decode_failed');
        if (await hashBuild(path.join(root, 'dist-app')) !== manifest.build.sha256) throw new Error('recorded_build_changed');
        const journal = path.join(directory, 'journal.ndjson');
        const analysis = await analyzeSession(manifest, journal);
        await save(path.join(output, 'selection.json'), analysis);
        if (!analysis.candidates.length) result.reasons = analysis.rejected.length ? analysis.rejected : ['no_complete_fight_with_reversal'];
        for (const [index, candidate] of analysis.candidates.entries()) {
            console.log(`Rendere und prüfe Kandidat ${index + 1} von ${analysis.candidates.length} …`);
            const folder = path.join(output, `candidate-${index + 1}`); await mkdir(folder);
            try {
                const replay = await loadCandidateReplay(manifest, journal, candidate);
                const replayPath = path.join(folder, 'replay.json'); await save(replayPath, replay);
                const configPath = path.join(folder, 'render-config.json');
                const resultPath = path.join(folder, 'render-result.json');
                await save(configPath, { action: 'render', replayPath, resultPath, journalPath: journal,
                    selection: candidate, output: path.join(folder, 'picture.mp4') });
                await run(electron, ['.'], { cwd: path.join(root, 'electron'), env: {
                    CURVIOS_MARKETING_CONFIG: configPath, CURVIOS_USER_DATA_ROOT: path.join(folder, 'render-profile'),
                    CURVIOS_ELECTRON_TEST_RENDER: 'inactive', CURVIOS_ELECTRON_SHOW_WINDOW: '0',
                } });
                const rendered = await json(resultPath);
                if (!rendered.saved) throw new Error(rendered.reason || 'render_failed');
                const cameraFailures = checkCameraSamples(rendered.cameraSamples);
                cameraFailures.push(...checkCameraVisibility(rendered.visibilitySamples, candidate.criticalTimes));
                if (cameraFailures.length) throw new Error(cameraFailures.slice(0, 5).join(', '));
                const probe = await exportSessionMedia({ folder, source: path.join(directory, 'original.webm'), candidate });
                const packageInfo = { status: 'needs-human-review', ...candidate, probe,
                    videoSha256: await hashFile(path.join(folder, 'video.mp4')), modelCalls: 0,
                    title: `${candidate.modeLabel}: rockets and a reversal`,
                    automaticChecks: ['source-integrity', 'participant-input-evidence', 'preroll', 'chronology', 'caption-event-types',
                        'camera-step-limits', 'subject-framing-and-world-occlusion', 'export-format', 'container-av-duration', 'decode', 'black-and-freeze'],
                    requiredReview: ['actual-impact-audio-sync', 'replay-versus-original', 'camera-occlusion', 'trail-visibility',
                        'phone-caption-legibility', 'story-comprehension', 'music-rights'],
                    source: { mediaSha256: manifest.mediaSha256, journalSha256: manifest.journalSha256 } };
                await save(path.join(folder, 'review.json'), packageInfo);
                result.candidates.push({ folder, status: packageInfo.status });
            } catch (error) {
                await save(path.join(folder, 'rejected.json'), { reason: error.message });
                result.reasons.push(error.message);
            }
        }
        if (result.candidates.length) result.status = 'needs-human-review';
    } catch (error) { result.reasons.push(error.message); }
    await save(path.join(output, 'result.json'), result);
    await writeFile(path.join(output, 'ERGEBNIS.txt'), result.candidates.length
        ? `Videokandidaten: ${result.candidates.length}\nBitte jedes Video vollständig ansehen, mit und ohne Ton.\nKandidaten sind noch nicht zur Veröffentlichung freigegeben.\n\n${result.candidates.map((c) => c.folder).join('\n')}\n\nOriginalaufnahme und Belege bleiben erhalten. Modellaufrufe: 0.\n`
        : `Keine geeigneten Videokandidaten erstellt.\nOriginalaufnahme und Belege bleiben erhalten.\n\nPrüfergebnisse:\n${[...new Set(result.reasons.map(explainRejection))].join('\n')}\n\nModellaufrufe: 0.\n`, { flag: 'wx' });
    console.log(`Marketing: ${result.status}. ${output}`);
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const { acquirePlaywrightRunLock, releasePlaywrightRunLockOnExit } = await import('../playwright-run-lock.mjs');
    const lock = await acquirePlaywrightRunLock({ label: 'marketing session processing' });
    releasePlaywrightRunLockOnExit(lock.release);
    try { await processSession(path.resolve(process.argv[2])); } finally { lock.release(); }
}
