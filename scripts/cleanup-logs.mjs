import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const ARCHIVE_DIR = path.join(LOGS_DIR, 'archive');

async function cleanupLogs() {
  console.log('Starte Log-Cleanup...');
  
  try {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    
    const files = await fs.readdir(PROJECT_ROOT);
    const logFiles = files.filter(f => f.startsWith('tmp-') && f.endsWith('.log'));
    
    if (logFiles.length === 0) {
      console.log('Keine temporären Log-Dateien im Root-Verzeichnis gefunden.');
      return;
    }

    console.log(`${logFiles.length} Log-Dateien gefunden. Verschiebe ins Archiv...`);
    
    for (const file of logFiles) {
      const oldPath = path.join(PROJECT_ROOT, file);
      const newPath = path.join(ARCHIVE_DIR, file);
      await fs.rename(oldPath, newPath);
    }
    
    console.log(`Erfolgreich ${logFiles.length} Dateien nach logs/archive verschoben.`);
  } catch (err) {
    console.error('Fehler beim Aufräumen der Logs:', err);
    process.exit(1);
  }
}

cleanupLogs();