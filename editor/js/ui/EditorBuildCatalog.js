import {
    CONTENT_DESCRIPTOR_TYPES,
    createContentRegistryDescriptor,
} from '../../../src/shared/contracts/ContentDescriptorContract.js';
import {
    EDITOR_OBJECT_TYPES,
    isKnownEditorObjectType,
} from '../../../src/shared/contracts/EditorAuthoringContract.js';

const CATEGORY_META = Object.freeze({
    build: Object.freeze({
        id: 'build',
        label: 'Bauen',
        accentColor: '#f97373',
        description: 'Bloecke und Tunnel fuer die Grundstruktur.'
    }),
    flow: Object.freeze({
        id: 'flow',
        label: 'Flow',
        accentColor: '#60a5fa',
        description: 'Portale und Spawn-Punkte fuer den Spielfluss.'
    }),
    pickups: Object.freeze({
        id: 'pickups',
        label: 'Pickups',
        accentColor: '#fbbf24',
        description: 'Items, Ressourcen und Belohnungen.'
    }),
    aircraft: Object.freeze({
        id: 'aircraft',
        label: 'Flugobjekte',
        accentColor: '#34d399',
        description: 'Schiffe und Flugzeuge fuer Deko oder Ziele.'
    }),
    parcours: Object.freeze({
        id: 'parcours',
        label: 'Parcours',
        accentColor: '#a78bfa',
        description: 'Checkpoints, Gates und Finish fuer Parcours-Routen.'
    })
});

function createBuildEntry({
    id,
    tool,
    subType = null,
    categoryId,
    label,
    description,
    previewGlyph,
    previewToken,
    sortOrder,
    keywords = [],
    badge = '',
    isFeatured = false,
    isDefault = false
}) {
    const category = CATEGORY_META[categoryId];
    if (!category) {
        throw new Error(`Unknown editor build category: ${categoryId}`);
    }
    if (!isKnownEditorObjectType(tool)) {
        throw new Error(`Unknown editor object type: "${tool}". Must be one of: ${Object.values(EDITOR_OBJECT_TYPES).join(', ')}`);
    }

    return Object.freeze({
        id,
        tool,
        subType,
        categoryId,
        categoryLabel: category.label,
        accentColor: category.accentColor,
        label,
        description,
        previewGlyph,
        previewToken,
        sortOrder,
        keywords: Array.isArray(keywords) ? [...keywords] : [],
        badge,
        isFeatured,
        isDefault
    });
}

export const EDITOR_BUILD_CATEGORIES = Object.freeze([
    CATEGORY_META.build,
    CATEGORY_META.flow,
    CATEGORY_META.pickups,
    CATEGORY_META.aircraft,
    CATEGORY_META.parcours
]);

export const EDITOR_BUILD_ITEMS = Object.freeze([
    createBuildEntry({
        id: 'build-hard',
        tool: 'hard',
        categoryId: 'build',
        label: 'Hartblock',
        description: 'Solider Block fuer Wande und Deckung.',
        previewGlyph: 'HB',
        previewToken: 'block-hard',
        sortOrder: 10,
        keywords: ['block', 'wall', 'solid'],
        badge: 'Standard',
        isFeatured: true,
        isDefault: true
    }),
    createBuildEntry({
        id: 'build-foam',
        tool: 'foam',
        categoryId: 'build',
        label: 'Schaumblock',
        description: 'Leichter Block fuer weichere Layout-Zonen.',
        previewGlyph: 'SB',
        previewToken: 'block-foam',
        sortOrder: 20,
        keywords: ['foam', 'soft', 'block'],
        badge: 'Alt',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'build-tunnel-segment',
        tool: 'tunnel',
        subType: 'trail_segment',
        categoryId: 'build',
        label: 'Tunnel Segment',
        description: 'Gerades Segment fuer Tunnel-Verbindungen.',
        previewGlyph: 'TS',
        previewToken: 'trail-segment',
        sortOrder: 30,
        keywords: ['tunnel', 'trail', 'segment'],
        badge: 'Flow',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'build-tunnel-arrow',
        tool: 'tunnel',
        subType: 'trail_arrow',
        categoryId: 'build',
        label: 'Tunnel Pfeil',
        description: 'Pfeilsegment fuer Richtungsfuehrung.',
        previewGlyph: 'TP',
        previewToken: 'trail-arrow',
        sortOrder: 40,
        keywords: ['tunnel', 'trail', 'arrow']
    }),
    createBuildEntry({
        id: 'build-tunnel-primitive',
        tool: 'tunnel',
        subType: '',
        categoryId: 'build',
        label: 'Tunnel Basis',
        description: 'Primitive Tunnelform ohne Asset-Abhaengigkeit.',
        previewGlyph: 'TB',
        previewToken: 'trail-primitive',
        sortOrder: 50,
        keywords: ['tunnel', 'primitive', 'fallback'],
        badge: 'Fallback'
    }),
    createBuildEntry({
        id: 'flow-portal-ring',
        tool: 'portal',
        subType: 'portal_ring',
        categoryId: 'flow',
        label: 'Portal Ring',
        description: 'Klassischer Ring als Standard-Portal.',
        previewGlyph: 'PR',
        previewToken: 'portal-ring',
        sortOrder: 10,
        keywords: ['portal', 'ring'],
        badge: 'Standard',
        isFeatured: true,
        isDefault: true
    }),
    createBuildEntry({
        id: 'flow-portal-cross',
        tool: 'portal',
        subType: 'portal_cross',
        categoryId: 'flow',
        label: 'Portal Cross',
        description: 'Kreuzform fuer markante Uebergaenge.',
        previewGlyph: 'PX',
        previewToken: 'portal-cross',
        sortOrder: 20,
        keywords: ['portal', 'cross']
    }),
    createBuildEntry({
        id: 'flow-portal-diamond',
        tool: 'portal',
        subType: 'portal_diamond',
        categoryId: 'flow',
        label: 'Portal Diamond',
        description: 'Diamantform fuer enge Flow-Hotspots.',
        previewGlyph: 'PD',
        previewToken: 'portal-diamond',
        sortOrder: 30,
        keywords: ['portal', 'diamond']
    }),
    createBuildEntry({
        id: 'flow-portal-hex',
        tool: 'portal',
        subType: 'portal_hex',
        categoryId: 'flow',
        label: 'Portal Hex',
        description: 'Sechseckiges Portal fuer technische Raeume.',
        previewGlyph: 'PH',
        previewToken: 'portal-hex',
        sortOrder: 40,
        keywords: ['portal', 'hex']
    }),
    createBuildEntry({
        id: 'flow-portal-octagon',
        tool: 'portal',
        subType: 'portal_octagon',
        categoryId: 'flow',
        label: 'Portal Octagon',
        description: 'Achtkant fuer grosse Arena-Uebergaenge.',
        previewGlyph: 'PO',
        previewToken: 'portal-octagon',
        sortOrder: 50,
        keywords: ['portal', 'octagon']
    }),
    createBuildEntry({
        id: 'flow-portal-square',
        tool: 'portal',
        subType: 'portal_square',
        categoryId: 'flow',
        label: 'Portal Square',
        description: 'Rechteckige Variante fuer kantige Routen.',
        previewGlyph: 'PS',
        previewToken: 'portal-square',
        sortOrder: 60,
        keywords: ['portal', 'square']
    }),
    createBuildEntry({
        id: 'flow-portal-star',
        tool: 'portal',
        subType: 'portal_star',
        categoryId: 'flow',
        label: 'Portal Star',
        description: 'Stern-Portal fuer Hero-Pfade und Events.',
        previewGlyph: 'PT',
        previewToken: 'portal-star',
        sortOrder: 70,
        keywords: ['portal', 'star']
    }),
    createBuildEntry({
        id: 'flow-portal-triangle',
        tool: 'portal',
        subType: 'portal_triangle',
        categoryId: 'flow',
        label: 'Portal Triangle',
        description: 'Dreiecks-Portal fuer steile Richtungswechsel.',
        previewGlyph: 'P3',
        previewToken: 'portal-triangle',
        sortOrder: 80,
        keywords: ['portal', 'triangle']
    }),
    createBuildEntry({
        id: 'flow-portal-primitive',
        tool: 'portal',
        subType: '',
        categoryId: 'flow',
        label: 'Portal Basis',
        description: 'Primitive Torus-Variante als robuster Fallback.',
        previewGlyph: 'PB',
        previewToken: 'portal-primitive',
        sortOrder: 90,
        keywords: ['portal', 'primitive', 'fallback'],
        badge: 'Fallback'
    }),
    createBuildEntry({
        id: 'flow-spawn-player',
        tool: 'spawn',
        subType: 'player',
        categoryId: 'flow',
        label: 'Player Spawn',
        description: 'Startpunkt fuer den Spieler.',
        previewGlyph: 'P1',
        previewToken: 'spawn-player',
        sortOrder: 100,
        keywords: ['spawn', 'player', 'start'],
        badge: 'Gameplay',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'flow-spawn-bot',
        tool: 'spawn',
        subType: 'bot',
        categoryId: 'flow',
        label: 'Bot Spawn',
        description: 'Spawn fuer KI oder Gegnerdruck.',
        previewGlyph: 'AI',
        previewToken: 'spawn-bot',
        sortOrder: 110,
        keywords: ['spawn', 'bot', 'enemy'],
        badge: 'Gameplay',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'pickups-crystal',
        tool: 'item',
        subType: 'item_crystal',
        categoryId: 'pickups',
        label: 'Kristall',
        description: 'Klassischer Sammelpunkt mit klarem Read.',
        previewGlyph: 'CR',
        previewToken: 'item-crystal',
        sortOrder: 10,
        keywords: ['item', 'crystal'],
        badge: 'Standard',
        isFeatured: true,
        isDefault: true
    }),
    createBuildEntry({
        id: 'pickups-star',
        tool: 'item',
        subType: 'item_star',
        categoryId: 'pickups',
        label: 'Stern',
        description: 'Sichtbarer Bonus fuer Reward-Linien.',
        previewGlyph: 'ST',
        previewToken: 'item-star',
        sortOrder: 20,
        keywords: ['item', 'star']
    }),
    createBuildEntry({
        id: 'pickups-battery',
        tool: 'item',
        subType: 'item_battery',
        categoryId: 'pickups',
        label: 'Batterie',
        description: 'Utility-Pickup fuer Versorgungszonen.',
        previewGlyph: 'BT',
        previewToken: 'item-battery',
        sortOrder: 30,
        keywords: ['item', 'battery']
    }),
    createBuildEntry({
        id: 'pickups-shield',
        tool: 'item',
        subType: 'item_shield',
        categoryId: 'pickups',
        label: 'Schild',
        description: 'Defensiver Pickup fuer Risk-Reward-Kurven.',
        previewGlyph: 'SH',
        previewToken: 'item-shield',
        sortOrder: 40,
        keywords: ['item', 'shield']
    }),
    createBuildEntry({
        id: 'pickups-box',
        tool: 'item',
        subType: 'item_box',
        categoryId: 'pickups',
        label: 'Item-Box',
        description: 'Standardbox fuer zufaellige Belohnungen.',
        previewGlyph: 'BX',
        previewToken: 'item-box',
        sortOrder: 50,
        keywords: ['item', 'box'],
        badge: 'Gameplay',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'pickups-pyramid',
        tool: 'item',
        subType: 'item_pyramid',
        categoryId: 'pickups',
        label: 'Pyramide',
        description: 'Deko- oder Signalform mit klarer Silhouette.',
        previewGlyph: 'PY',
        previewToken: 'item-pyramid',
        sortOrder: 60,
        keywords: ['item', 'pyramid']
    }),
    createBuildEntry({
        id: 'pickups-arrow',
        tool: 'item',
        subType: 'item_arrow',
        categoryId: 'pickups',
        label: 'Pfeil',
        description: 'Richtungshinweis fuer Flow-Training.',
        previewGlyph: 'AR',
        previewToken: 'item-arrow',
        sortOrder: 70,
        keywords: ['item', 'arrow']
    }),
    createBuildEntry({
        id: 'pickups-capsule',
        tool: 'item',
        subType: 'item_capsule',
        categoryId: 'pickups',
        label: 'Kapsel',
        description: 'Langgezogener Pickup fuer Medizin oder Fuel.',
        previewGlyph: 'CP',
        previewToken: 'item-capsule',
        sortOrder: 80,
        keywords: ['item', 'capsule']
    }),
    createBuildEntry({
        id: 'pickups-coin',
        tool: 'item',
        subType: 'item_coin',
        categoryId: 'pickups',
        label: 'Muenze',
        description: 'Flacher Reward fuer Coin-Linien.',
        previewGlyph: 'CO',
        previewToken: 'item-coin',
        sortOrder: 90,
        keywords: ['item', 'coin']
    }),
    createBuildEntry({
        id: 'pickups-crate',
        tool: 'item',
        subType: 'item_crate',
        categoryId: 'pickups',
        label: 'Kiste',
        description: 'Schwere Box fuer sichtbare Pickup-Spots.',
        previewGlyph: 'KT',
        previewToken: 'item-crate',
        sortOrder: 100,
        keywords: ['item', 'crate']
    }),
    createBuildEntry({
        id: 'pickups-gem',
        tool: 'item',
        subType: 'item_gem',
        categoryId: 'pickups',
        label: 'Edelstein',
        description: 'Glanzpunkt fuer Premium-Pfade.',
        previewGlyph: 'GM',
        previewToken: 'item-gem',
        sortOrder: 110,
        keywords: ['item', 'gem']
    }),
    createBuildEntry({
        id: 'pickups-health',
        tool: 'item',
        subType: 'item_health',
        categoryId: 'pickups',
        label: 'Medipack',
        description: 'Health-Pickup fuer Erholung oder Risiko-Routen.',
        previewGlyph: 'HP',
        previewToken: 'item-health',
        sortOrder: 120,
        keywords: ['item', 'health', 'heal'],
        badge: 'Gameplay',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'pickups-orb',
        tool: 'item',
        subType: 'item_orb',
        categoryId: 'pickups',
        label: 'Orb',
        description: 'Neutrale Kugel fuer Deko oder Objectives.',
        previewGlyph: 'OB',
        previewToken: 'item-orb',
        sortOrder: 130,
        keywords: ['item', 'orb']
    }),
    createBuildEntry({
        id: 'pickups-ring',
        tool: 'item',
        subType: 'item_ring',
        categoryId: 'pickups',
        label: 'Ring',
        description: 'Ringform fuer Checkpoint- oder Reward-Linien.',
        previewGlyph: 'RG',
        previewToken: 'item-ring',
        sortOrder: 140,
        keywords: ['item', 'ring']
    }),
    createBuildEntry({
        id: 'pickups-rocket',
        tool: 'item',
        subType: 'item_rocket',
        categoryId: 'pickups',
        label: 'Rakete',
        description: 'Spezialpickup fuer Kampfzonen.',
        previewGlyph: 'RK',
        previewToken: 'item-rocket',
        sortOrder: 150,
        keywords: ['item', 'rocket'],
        badge: 'Gameplay',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'pickups-sphere',
        tool: 'item',
        subType: 'item_sphere',
        categoryId: 'pickups',
        label: 'Sphaere',
        description: 'Volle Kugel fuer neutrale Pickup-Marker.',
        previewGlyph: 'SP',
        previewToken: 'item-sphere',
        sortOrder: 160,
        keywords: ['item', 'sphere']
    }),
    createBuildEntry({
        id: 'pickups-torus',
        tool: 'item',
        subType: 'item_torus',
        categoryId: 'pickups',
        label: 'Torus',
        description: 'Technischer Ring fuer Spezialspots.',
        previewGlyph: 'TO',
        previewToken: 'item-torus',
        sortOrder: 170,
        keywords: ['item', 'torus']
    }),
    createBuildEntry({
        id: 'aircraft-ship5',
        tool: 'aircraft',
        subType: 'jet_ship5',
        categoryId: 'aircraft',
        label: 'Ship 5',
        description: 'Standard-Schiff fuer schnelle Platzierung.',
        previewGlyph: 'S5',
        previewToken: 'aircraft-ship',
        sortOrder: 10,
        keywords: ['aircraft', 'ship', 'standard'],
        badge: 'Standard',
        isFeatured: true,
        isDefault: true
    }),
    createBuildEntry({
        id: 'aircraft-ship1',
        tool: 'aircraft',
        subType: 'jet_ship1',
        categoryId: 'aircraft',
        label: 'Ship 1',
        description: 'Kompakte Schiffsilhouette fuer Variation.',
        previewGlyph: 'S1',
        previewToken: 'aircraft-ship',
        sortOrder: 20,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship2',
        tool: 'aircraft',
        subType: 'jet_ship2',
        categoryId: 'aircraft',
        label: 'Ship 2',
        description: 'Leicht breitere Schiffsklasse fuer Szenenaufbau.',
        previewGlyph: 'S2',
        previewToken: 'aircraft-ship',
        sortOrder: 30,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship3',
        tool: 'aircraft',
        subType: 'jet_ship3',
        categoryId: 'aircraft',
        label: 'Ship 3',
        description: 'Mittlere Silhouette fuer Flottenbilder.',
        previewGlyph: 'S3',
        previewToken: 'aircraft-ship',
        sortOrder: 40,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship4',
        tool: 'aircraft',
        subType: 'jet_ship4',
        categoryId: 'aircraft',
        label: 'Ship 4',
        description: 'Variantenmodell fuer Staffeln und Hintergruende.',
        previewGlyph: 'S4',
        previewToken: 'aircraft-ship',
        sortOrder: 50,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship6',
        tool: 'aircraft',
        subType: 'jet_ship6',
        categoryId: 'aircraft',
        label: 'Ship 6',
        description: 'Alternative Standardhaube fuer Formation-Szenen.',
        previewGlyph: 'S6',
        previewToken: 'aircraft-ship',
        sortOrder: 60,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship7',
        tool: 'aircraft',
        subType: 'jet_ship7',
        categoryId: 'aircraft',
        label: 'Ship 7',
        description: 'Breite Schiffsnase fuer starke Silhouette.',
        previewGlyph: 'S7',
        previewToken: 'aircraft-ship',
        sortOrder: 70,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship8',
        tool: 'aircraft',
        subType: 'jet_ship8',
        categoryId: 'aircraft',
        label: 'Ship 8',
        description: 'Langgezogene Variante fuer Escort-Linien.',
        previewGlyph: 'S8',
        previewToken: 'aircraft-ship',
        sortOrder: 80,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-ship9',
        tool: 'aircraft',
        subType: 'jet_ship9',
        categoryId: 'aircraft',
        label: 'Ship 9',
        description: 'Spitze Silhouette fuer schnelle Ueberfluege.',
        previewGlyph: 'S9',
        previewToken: 'aircraft-ship',
        sortOrder: 90,
        keywords: ['aircraft', 'ship']
    }),
    createBuildEntry({
        id: 'aircraft-wwi',
        tool: 'aircraft',
        subType: 'jet_wwi',
        categoryId: 'aircraft',
        label: 'WWI Airplane',
        description: 'Biplane-Variante fuer Retro-Luftpfade.',
        previewGlyph: 'WW',
        previewToken: 'aircraft-wwi',
        sortOrder: 100,
        keywords: ['aircraft', 'wwi', 'plane']
    }),
    createBuildEntry({
        id: 'aircraft-funky-low',
        tool: 'aircraft',
        subType: 'jet_funky_low',
        categoryId: 'aircraft',
        label: 'Funky Low',
        description: 'Niedrige Funky-Variante fuer schrille Szenen.',
        previewGlyph: 'FL',
        previewToken: 'aircraft-funky',
        sortOrder: 110,
        keywords: ['aircraft', 'funky']
    }),
    createBuildEntry({
        id: 'aircraft-funky-high',
        tool: 'aircraft',
        subType: 'jet_funky_high',
        categoryId: 'aircraft',
        label: 'Funky High',
        description: 'Groessere Funky-Version fuer Deko-Hotspots.',
        previewGlyph: 'FH',
        previewToken: 'aircraft-funky',
        sortOrder: 120,
        keywords: ['aircraft', 'funky']
    }),
    createBuildEntry({
        id: 'aircraft-funky-control',
        tool: 'aircraft',
        subType: 'jet_funky_control',
        categoryId: 'aircraft',
        label: 'Funky Control',
        description: 'Kontrollmodell fuer abstrakte Flight-Zonen.',
        previewGlyph: 'FC',
        previewToken: 'aircraft-funky',
        sortOrder: 130,
        keywords: ['aircraft', 'funky', 'control']
    }),
    createBuildEntry({
        id: 'aircraft-pinnace-lo',
        tool: 'aircraft',
        subType: 'jet_pinnace_lo',
        categoryId: 'aircraft',
        label: 'Pinnace Lo',
        description: 'Schwere Low-Poly-Pinnace fuer Armada-Bilder.',
        previewGlyph: 'PN',
        previewToken: 'aircraft-pinnace',
        sortOrder: 140,
        keywords: ['aircraft', 'pinnace']
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-entry',
        tool: 'checkpoint',
        subType: 'entry',
        categoryId: 'parcours',
        label: 'Start (Entry)',
        description: 'Einstiegs-Checkpoint am Anfang der Route.',
        previewGlyph: 'EN',
        previewToken: 'checkpoint-entry',
        sortOrder: 10,
        keywords: ['checkpoint', 'entry', 'start', 'parcours'],
        badge: 'Start',
        isFeatured: true,
        isDefault: true
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-gate',
        tool: 'checkpoint',
        subType: 'gate',
        categoryId: 'parcours',
        label: 'Gate',
        description: 'Standard-Checkpoint entlang der Route.',
        previewGlyph: 'GT',
        previewToken: 'checkpoint-gate',
        sortOrder: 20,
        keywords: ['checkpoint', 'gate', 'parcours'],
        badge: 'Standard',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-tunnel',
        tool: 'checkpoint',
        subType: 'tunnel',
        categoryId: 'parcours',
        label: 'Tunnel-CP',
        description: 'Checkpoint innerhalb eines Tunnels.',
        previewGlyph: 'TN',
        previewToken: 'checkpoint-tunnel',
        sortOrder: 30,
        keywords: ['checkpoint', 'tunnel', 'parcours'],
        isFeatured: true
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-split',
        tool: 'checkpoint',
        subType: 'split',
        categoryId: 'parcours',
        label: 'Split (Lane)',
        description: 'Wegverzweigung – aliasOf fuer Alternativrouten.',
        previewGlyph: 'SP',
        previewToken: 'checkpoint-split',
        sortOrder: 40,
        keywords: ['checkpoint', 'split', 'lane', 'parcours'],
        badge: 'Verzweigung',
        isFeatured: true
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-precision',
        tool: 'checkpoint',
        subType: 'precision',
        categoryId: 'parcours',
        label: 'Praezision',
        description: 'Enger Checkpoint fuer Praezisions-Abschnitte.',
        previewGlyph: 'PR',
        previewToken: 'checkpoint-precision',
        sortOrder: 50,
        keywords: ['checkpoint', 'precision', 'parcours']
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-finish-pre',
        tool: 'checkpoint',
        subType: 'finish_pre',
        categoryId: 'parcours',
        label: 'Vor-Finish',
        description: 'Letzter Checkpoint vor dem Ziel.',
        previewGlyph: 'VF',
        previewToken: 'checkpoint-finish-pre',
        sortOrder: 60,
        keywords: ['checkpoint', 'finish', 'pre', 'parcours']
    }),
    createBuildEntry({
        id: 'parcours-checkpoint-finish',
        tool: 'checkpoint',
        subType: 'finish',
        categoryId: 'parcours',
        label: 'Finish (Ziel)',
        description: 'Zielpunkt der Parcours-Route.',
        previewGlyph: 'FI',
        previewToken: 'checkpoint-finish',
        sortOrder: 70,
        keywords: ['checkpoint', 'finish', 'ziel', 'parcours'],
        badge: 'Ziel',
        isFeatured: true
    })
].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label)));

function createEditorBuildDescriptorEntries() {
    return EDITOR_BUILD_ITEMS.map((entry) => ({
        id: entry.id,
        tool: entry.tool,
        subType: entry.subType ?? '',
        categoryId: entry.categoryId,
        categoryLabel: entry.categoryLabel,
        accentColor: entry.accentColor,
        label: entry.label,
        description: entry.description,
        previewGlyph: entry.previewGlyph,
        previewToken: entry.previewToken,
        sortOrder: entry.sortOrder,
        keywords: Array.isArray(entry.keywords) ? [...entry.keywords] : [],
        badge: entry.badge || '',
        isFeatured: entry.isFeatured === true,
        isDefault: entry.isDefault === true,
    }));
}

function createEditorBuildCatalogDescriptorValue() {
    return createContentRegistryDescriptor({
        descriptorType: CONTENT_DESCRIPTOR_TYPES.EDITOR_BUILD_CATALOG,
        source: 'editor/js/ui/EditorBuildCatalog.js',
        entries: createEditorBuildDescriptorEntries(),
        metadata: {
            categories: EDITOR_BUILD_CATEGORIES.map((entry) => ({
                id: entry.id,
                label: entry.label,
                accentColor: entry.accentColor,
                description: entry.description,
            })),
        },
    });
}

const EDITOR_BUILD_CATALOG_DESCRIPTOR = createEditorBuildCatalogDescriptorValue();
const BUILD_ITEM_MAP = new Map(EDITOR_BUILD_CATALOG_DESCRIPTOR.entries.map((entry) => [entry.id, entry]));
export const EDITOR_TEMPLATE_IMPORT_CAPABILITY_CONTRACT_VERSION = 'editor-template-import-capability.v1';

function cloneDescriptorEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
        ...entry,
        keywords: Array.isArray(entry.keywords) ? [...entry.keywords] : [],
    };
}

export function getEditorBuildCategories() {
    const categories = Array.isArray(EDITOR_BUILD_CATALOG_DESCRIPTOR.metadata?.categories)
        ? EDITOR_BUILD_CATALOG_DESCRIPTOR.metadata.categories
        : [];
    return categories.map((entry) => cloneDescriptorEntry(entry));
}

export function getEditorBuildEntriesForCategory(categoryId) {
    return EDITOR_BUILD_CATALOG_DESCRIPTOR.entries
        .filter((entry) => entry.categoryId === categoryId)
        .map((entry) => cloneDescriptorEntry(entry));
}

export function getEditorBuildFeaturedEntries() {
    return EDITOR_BUILD_CATALOG_DESCRIPTOR.entries
        .filter((entry) => entry.isFeatured === true)
        .map((entry) => cloneDescriptorEntry(entry));
}

export function findEditorBuildEntryById(entryId) {
    return cloneDescriptorEntry(BUILD_ITEM_MAP.get(String(entryId || '').trim()));
}

export function findEditorBuildEntryByToolAndSubtype(tool, subType = null) {
    const normalizedTool = String(tool || '').trim();
    const normalizedSubtype = String(subType ?? '');
    const match = EDITOR_BUILD_CATALOG_DESCRIPTOR.entries.find((entry) => (
        entry.tool === normalizedTool
        && String(entry.subType ?? '') === normalizedSubtype
    ));
    return cloneDescriptorEntry(match);
}

export function getEditorBuildDefaultEntry(categoryId = 'build') {
    const categoryItems = getEditorBuildEntriesForCategory(categoryId);
    return categoryItems.find((entry) => entry.isDefault) || categoryItems[0] || findEditorBuildEntryById(EDITOR_BUILD_ITEMS[0]?.id) || null;
}

export function listEditorBuildDescriptorEntries() {
    return EDITOR_BUILD_CATALOG_DESCRIPTOR.entries.map((entry) => cloneDescriptorEntry(entry));
}

export function getEditorBuildCatalogDescriptor() {
    return EDITOR_BUILD_CATALOG_DESCRIPTOR;
}

export function getEditorTemplateRegistryDescriptor() {
    return createContentRegistryDescriptor({
        descriptorType: CONTENT_DESCRIPTOR_TYPES.EDITOR_TEMPLATES,
        source: 'editor/templates/**',
        status: 'missing',
        entries: [],
        metadata: {
            reason: 'templates_path_not_present',
        },
    });
}

export function resolveEditorTemplateImportCapability(descriptor = null) {
    const templateDescriptor = descriptor && typeof descriptor === 'object'
        ? descriptor
        : getEditorTemplateRegistryDescriptor();
    const entryCount = Number(templateDescriptor?.entryCount) || 0;
    const status = String(templateDescriptor?.status || '').trim() || 'unknown';
    const available = status === 'ready' && entryCount > 0;
    const degradedReason = available
        ? ''
        : (status === 'missing' ? 'templates_path_not_present' : `templates_${status}`);
    const message = available
        ? 'Editor-Templates sind verfuegbar.'
        : (status === 'missing'
            ? 'Editor-Templates fehlen aktuell unter editor/templates/**; Template-Import bleibt deaktiviert.'
            : `Editor-Templates sind derzeit nicht verfuegbar (${status}).`);
    return Object.freeze({
        contractVersion: EDITOR_TEMPLATE_IMPORT_CAPABILITY_CONTRACT_VERSION,
        descriptorVersion: String(templateDescriptor?.descriptorVersion || ''),
        source: String(templateDescriptor?.source || 'editor/templates/**'),
        status,
        entryCount,
        available,
        degradedReason,
        message,
    });
}
