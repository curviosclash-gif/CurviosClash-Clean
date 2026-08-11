// Build-Zeit-Konstanten, die Vite ueber `define` in den Quelltext einsetzt.
// Die Werte entstehen in createRendererBuildDefines() nebenan; zur Laufzeit stehen
// dort Literale. TypeScript sieht die define-Konfiguration nicht und meldete jede
// Verwendung als TS2304 "Cannot find name".
//
// Alle Namen werden im Produktcode hinter `typeof X !== 'undefined'` benutzt, weil
// sie in einem ungebauten Kontext (Node-Tests, roher ESM-Import) fehlen.
//
// Die drei __TURN_*__-Defines stehen absichtlich nicht hier: sie werden nur als
// Eigenschaft eines Global-Objekts gelesen, nie als blosser Bezeichner.

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_ID__: string;
declare const __CURVIOS_E2E__: boolean;
declare const __APP_MODE__: string;
declare const __APP_TARGET__: string;
declare const __SIGNALING_URL__: string;
