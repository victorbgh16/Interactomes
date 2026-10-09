import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtenir le chemin du fichier courant (équivalent de __dirname en CommonJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chemin vers le fichier FASTA
//const fastaPath = path.resolve(__dirname, '../../static/fasta/Bovinecilia.fasta');
const fastaPath = path.resolve(__dirname, '../../static/fasta/uniprotkb_cyanophora_paradoxa_2024_02_20.fasta');
function countFastaEntries(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n');
        const count = lines.filter(line => line.startsWith('>')).length;
        console.log(`Number of entries: ${count}`);
    } catch (err) {
        console.error('Error reading file:', err.message);
    }
}

countFastaEntries(fastaPath);
