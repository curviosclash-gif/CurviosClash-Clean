import { test, expect } from '@playwright/test';
import { loadGame } from './helpers.js';

test.describe('V59-59.7.1: MediaRecorderSystem', () => {

    test('Recording system initializes with correct default state', async ({ page }) => {
        await loadGame(page);
        const state = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const rec = g?.mediaRecorderSystem || g?.recorder;
            if (!rec) return { found: false };
            return {
                found: true,
                isRecording: !!rec.isRecording?.(),
                hasSettings: typeof rec.getRecordingCaptureSettings === 'function',
            };
        });
        expect(state.found).toBe(true);
        expect(state.isRecording).toBe(false);
        expect(state.hasSettings).toBe(true);
    });

    test('Recording capture settings have valid defaults', async ({ page }) => {
        await loadGame(page);
        const settings = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const rec = g?.mediaRecorderSystem || g?.recorder;
            return rec?.getRecordingCaptureSettings?.() || null;
        });
        expect(settings).not.toBeNull();
        expect(settings.profile).toBeTruthy();
        expect(settings.hudMode).toBeTruthy();
    });

    test('Browser recording capability adapter reports browser-native or degraded demo state consistently', async ({ page }) => {
        await loadGame(page);
        const state = await page.evaluate(async () => {
            const { createPlatformRecordingCapabilityAdapter } = await import('/src/core/recording/MediaRecorderSupport.js');
            const canvas = document.querySelector('canvas');
            const adapter = createPlatformRecordingCapabilityAdapter(globalThis, canvas);
            return {
                adapterName: adapter?.adapterName || '',
                contractVersion: adapter?.contractVersion || '',
                providerKind: adapter?.capability?.providerKind || '',
                degradedReason: adapter?.capability?.degradedReason || '',
                available: adapter?.isAvailable?.() === true,
                supportReason: adapter?.support?.supportReason || '',
                hasRecorder: adapter?.support?.hasRecorder === true,
            };
        });
        expect(state.adapterName).toBe('browser.recording.v1');
        expect(state.contractVersion).toBe('browser.recording.v1');
        expect(['browser-demo', 'browser-native']).toContain(state.providerKind);
        expect(typeof state.supportReason).toBe('string');
        if (state.available) {
            expect(state.providerKind).toBe('browser-native');
            expect(state.hasRecorder).toBe(true);
        } else {
            expect(state.providerKind).toBe('browser-demo');
            expect(state.degradedReason.length).toBeGreaterThan(0);
        }
    });

    test('Format detection returns supported MIME type', async ({ page }) => {
        await loadGame(page);
        const mime = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const rec = g?.mediaRecorderSystem || g?.recorder;
            return rec?.getActiveMimeType?.() || rec?._activeMimeType || 'unknown';
        });
        expect(typeof mime).toBe('string');
    });

    test('Browser recorder support keeps MIME selection and capture capability aligned', async ({ page }) => {
        await loadGame(page);
        const state = await page.evaluate(async () => {
            const {
                detectNativeRecorderSupport,
                resolveSafeMediaRecorderMimeType,
            } = await import('/src/core/recording/MediaRecorderSupport.js');
            const canvas = document.querySelector('canvas');
            const support = detectNativeRecorderSupport(globalThis, canvas);
            return {
                found: !!support,
                hasRecorder: support?.hasRecorder === true,
                hasMediaRecorder: support?.hasMediaRecorder === true,
                hasWebCodecs: support?.hasWebCodecs === true,
                selectedMimeType: support?.selectedMimeType || '',
                supportReason: support?.supportReason || '',
                safeMp4MimeType: resolveSafeMediaRecorderMimeType(globalThis, 'video/mp4'),
                canCaptureStream: typeof canvas?.captureStream === 'function',
            };
        });
        expect(state.found).toBe(true);
        expect(state.supportReason.length).toBeGreaterThan(0);
        expect(typeof state.safeMp4MimeType).toBe('string');
        if (state.hasRecorder) {
            expect(state.selectedMimeType.length).toBeGreaterThan(0);
        }
        if (state.hasMediaRecorder) {
            expect(state.canCaptureStream).toBe(true);
        }
        if (state.hasWebCodecs) {
            expect(state.selectedMimeType).toBe('video/mp4');
        }
    });
});
