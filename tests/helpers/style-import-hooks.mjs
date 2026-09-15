/**
 * Loader-Hook fuer den Node-Testlauf: Quellmodule der Oberflaeche importieren ihr
 * Stylesheet direkt (`import './x.css'`). Vite loest das beim Bauen auf, Node
 * kennt die Endung nicht. Der Hook liefert dafuer ein leeres Modul.
 */
export async function load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
        return { format: 'module', shortCircuit: true, source: 'export default "";' };
    }
    return nextLoad(url, context);
}
