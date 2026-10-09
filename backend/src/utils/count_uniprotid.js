// count_uniprot.js
import fs from 'fs';
import { parse } from 'csv-parse/sync';

function pick(fieldNames, obj) {
    for (const name of fieldNames) {
        if (name in obj) return obj[name];
        // tolère variantes de casse
        const key = Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase());
        if (key) return obj[key];
    }
    return undefined;
}

function clean(val) {
    if (val == null) return null;
    const v = String(val).trim();
    if (!v) return null;
    if (v.toLowerCase() === 'ambiguous') return null;
    return v;
}

function countUniProt(csvText) {
    const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    });

    const set1 = new Set();
    const set2 = new Set();
    const union = new Set();

    for (const row of rows) {
        const v1 = clean(pick(['Protein1','Proteine1','protein1','proteine1'], row));
        const v2 = clean(pick(['Protein2','Proteine2','protein2','proteine2'], row));

        if (v1) { set1.add(v1); union.add(v1); }
        if (v2) { set2.add(v2); union.add(v2); }
    }

    return {
        distinct_in_Protein1: set1.size,
        distinct_in_Protein2: set2.size,
        distinct_union_both: union.size,
        // si tu veux les listes, décommente:
        // list_Protein1: [...set1],
        // list_Protein2: [...set2],
        // list_union: [...union],
    };
}

// --- CLI ---
if (process.argv.length < 3) {
    console.error('Usage: node count_uniprot.js <file.csv>');
    process.exit(1);
}
const path = process.argv[2];
const csvText = fs.readFileSync(path, 'utf-8');
const out = countUniProt(csvText);
console.log(out);
