<template>
  <div class="protein-info" v-if="protein">
    <h3>Protein Information</h3>
    <ul>
      <li><strong>Uniprot ID:</strong> {{ protein.uniprot_id }}</li>
      <li><strong>Name:</strong> {{ protein.protein_name }}</li>
      <li><strong>Gene:</strong> {{ protein.gene_name }}</li>

      <!-- Séquence + légende -->
      <li class="sequence-header">
        <div class="seq-label">
          <strong>Sequence:</strong>
          <span class="seq-size">{{ (protein.sequence?.length ?? 0) }} amino acids</span>
        </div>
        <pre class="sequence" v-html="styledSequence"></pre>

        <div class="legend">
          <div class="legend-item">
            <span class="legend-color intra"></span> Intraprotein
          </div>
          <div class="legend-item">
            <span class="legend-color inter"></span> Interprotein
          </div>
          <div class="legend-item">
            <span class="legend-color both"></span> Intraprotein & Interprotein
          </div>
        </div>
      </li>

      <!-- Statistiques crosslinks -->
      <li><strong>Number of unique crosslinks: </strong> {{ crosslinkStats.uniqueCount }}</li>
      <li class="crosslink-sub">- Intra-protein Crosslinks: {{ crosslinkStats.intraCount }}</li>
      <li class="crosslink-sub">- Inter-protein Crosslinks: {{ crosslinkStats.interCount }}</li>
      <li><strong>Number of non-unique crosslinks:</strong> {{ crosslinkStats.crosslinkCount }}</li>

      <!-- Gene Ontology -->
      <li v-if="parsedGOTerms.length" class="go-section">
        <h4 class="go-title">Gene Ontology</h4>

        <!-- Résumé (chips) -->
        <div class="go-summary">
          <template v-for="k in ASPECT_ORDER" :key="'chip-'+k">
      <span
          v-if="groupedGO[k] && groupedGO[k].length"
          class="go-chip"
          :class="'aspect-'+k"
      >
        <span class="dot"></span>
        {{ ASPECT_INFO[k].label }}
        <b>{{ groupedGO[k].length }}</b>
      </span>
          </template>
        </div>

        <!-- Groupes par aspect -->
        <div class="go-groups">
          <template v-for="k in ASPECT_ORDER" :key="'group-'+k">
            <section
                v-if="groupedGO[k] && groupedGO[k].length"
                class="go-group"
                :class="'aspect-'+k"
            >
              <header class="go-group-head">
          <span class="left">
            <span class="dot"></span>
            {{ ASPECT_INFO[k].label }}
          </span>
                <span class="right">{{ groupedGO[k].length }}</span>
              </header>

              <div class="go-card-list">
                <article
                    v-for="g in groupedGO[k]"
                    :key="g.id"
                    class="go-card"
                    :class="'aspect-'+k"
                >
                  <header class="go-card-head">
                    <a
                        class="go-id"
                        :href="quickgoUrl(g.id)"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                      {{ g.id }}
                    </a>
                  </header>
                  <div class="go-term">{{ g.term }}</div>
                </article>
              </div>
            </section>
          </template>
        </div>
      </li>


      <!-- Subcellular locations -->
      <li v-if="parsedSubLoc.length" class="sl-section">
        <h4 class="go-title">Subcellular Locations</h4>

      <!-- résumé par catégorie -->
      <div class="sl-summary">
        <template v-for="k in SL_ORDER" :key="'sl-chip-'+k">
          <span
              v-if="groupedSubLoc[k] && groupedSubLoc[k].length"
              class="sl-chip"
              :class="'sl-'+k"
          >
          <span class="dot"></span>
            {{ SL_LABEL[k] }}
            <b>{{ groupedSubLoc[k].length }}</b>
          </span>
        </template>
      </div>


        <!-- groupes par catégorie -->
        <div class="sl-groups">
          <template v-for="k in SL_ORDER" :key="'sl-group-'+k">
            <section
                v-if="groupedSubLoc[k] && groupedSubLoc[k].length"
                class="sl-group"
                :class="'sl-'+k"
            >
              <header class="sl-group-head">
                <span class="left"><span class="dot"></span>{{ SL_LABEL[k] }}</span>
                <span class="right">{{ groupedSubLoc[k].length }}</span>
              </header>

              <div class="sl-card-list">
                <article
                    v-for="loc in groupedSubLoc[k]"
                    :key="(loc.id || 'noid') + '|' + loc.value"
                    class="sl-card"
                >
                  <header class="sl-card-head">
                    <span class="sl-kind">{{ SL_LABEL[k] }}</span>
                    <a v-if="loc.id" class="sl-id" :href="slUrl(loc.id)" target="_blank" rel="noopener noreferrer">{{ loc.id }}</a>
                  </header>
                  <div class="sl-term">{{ loc.value }}</div>

                  <ul v-if="loc.evidences?.length" class="sl-ev-list">
                    <li v-for="(ev,i) in loc.evidences" :key="i" class="sl-ev">
                      <code v-if="ev.evidenceCode">{{ ev.evidenceCode }}</code>
                      <span v-if="ev.source"> — {{ ev.source }}</span>
                      <template v-if="ev.source==='PubMed' && ev.id">
                        : <a :href="`https://pubmed.ncbi.nlm.nih.gov/${ev.id}/`" target="_blank" rel="noopener noreferrer">{{ ev.id }}</a>
                      </template>
                      <template v-else-if="ev.id"> ({{ ev.id }}) </template>
                    </li>
                  </ul>
                </article>
              </div>
            </section>
          </template>
        </div>

      </li>

      <!-- STRING references -->
      <li v-if="stringRefs.length" class="string-section">
        <h4 class="go-title">STRING</h4>
        <div class="string-chips">
          <a
              v-for="sid in stringRefs"
              :key="sid"
              class="string-chip"
              :href="stringUrl(sid)"
              target="_blank"
              rel="noopener noreferrer"
              title="Open in STRING"
          >
            {{ sid }}
          </a>
        </div>
      </li>





    </ul>
  </div>

  <div v-else class="placeholder">
    <p>Select a protein to see details.</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '@/store/dataStore'

const store = useDataStore();

const { protein } = defineProps({
  protein: {
    type: Object,
    default: null
  }
})

/* ---------- Crosslink coloration sur séquence ---------- */
const crosslinkMap = computed(() => {
  const map = {}
  const proteinId = protein?.uniprot_id
  if (!proteinId || !store.csvData) return map

  store.csvData.forEach(entry => {
    const { Protein1, Protein2, AbsPos1, AbsPos2 } = entry
    const isIntra = Protein1 === Protein2

    if (Protein1 === proteinId) {
      const pos = Number(AbsPos1)
      if (!map[pos]) map[pos] = new Set()
      map[pos].add(isIntra ? 'intra' : 'inter')
    }
    if (Protein2 === proteinId) {
      const pos = Number(AbsPos2)
      if (!map[pos]) map[pos] = new Set()
      map[pos].add(isIntra ? 'intra' : 'inter')
    }
  })
  return map
})

const crosslinkStats = computed(() => {
  const stats = { crosslinkCount: 0, uniqueCount: 0, intraCount: 0, interCount: 0 }
  if (!protein?.uniprot_id || !store.csvData || !store.fastaData) return stats

  const id = protein.uniprot_id.toUpperCase()
  const fastaMap = new Map(store.fastaData.map(p => [p.uniprot_id.toUpperCase(), true]))
  const uniqueSet = new Set()

  store.csvData.forEach(link => {
    const p1 = (link.Protein1 || '').trim().toUpperCase()
    const p2 = (link.Protein2 || '').trim().toUpperCase()
    const pos1 = parseInt(link.AbsPos1)
    const pos2 = parseInt(link.AbsPos2)
    if (!fastaMap.has(p1) || !fastaMap.has(p2)) return
    if (isNaN(pos1) || isNaN(pos2)) return
    if (p1 !== id && p2 !== id) return

    stats.crosslinkCount++

    const [protA, protB] = p1 < p2 ? [p1, p2] : [p2, p1]
    const [absA, absB] = pos1 < pos2 ? [pos1, pos2] : [pos2, pos1]
    const key = `${protA}|${protB}|${absA}|${absB}`

    if (!uniqueSet.has(key)) {
      uniqueSet.add(key)
      const isSameProtein = protA === protB && protA === id
      const isInterProtein = (protA === id || protB === id) && protA !== protB
      if (isSameProtein) stats.intraCount++
      else if (isInterProtein && absA !== absB) stats.interCount++
    }
  })
  stats.uniqueCount = uniqueSet.size
  return stats
})

const styledSequence = computed(() => {
  if (!protein?.sequence) return ''
  return protein.sequence.split('').map((aa, idx) => {
    const pos = idx + 1
    const types = crosslinkMap.value[pos]
    let style = ''
    if (types?.has('intra') && types?.has('inter'))      style = 'color: pink; font-weight: bold;'
    else if (types?.has('intra'))                        style = 'color: orange; font-weight: bold;'
    else if (types?.has('inter'))                        style = 'color: purple; font-weight: bold;'
    return `<span style="${style}">${aa}</span>`
  }).join('')
})

/* ---------- Gene Ontology (GO) ---------- */
const parsedGOTerms = computed(() => {
  const raw = protein?.go_terms
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(x => x && x.id && x.term)
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter(x => x && x.id && x.term) : []
    } catch { return [] }
  }
  return []
})

// Helpers liens
const slUrl = (slId) => slId ? `https://www.uniprot.org/locations/${encodeURIComponent(slId)}` : '#';
const stringUrl = (sid) => `https://string-db.org/network/${encodeURIComponent(sid)}`;

// Subcellular locations: string JSON -> tableau
const parsedSubLoc = computed(() => {
  const raw = protein?.subcellular_locations;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(x => x && x.value);
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(x => x && x.value) : [];
    } catch {
      return [];
    }
  }
  return [];
});

// Grouper par nature (location, topology, orientation, note)
const SL_ORDER = ['location','topology','orientation','note'];
const SL_LABEL = {
  location: 'Location',
  topology: 'Topology',
  orientation: 'Orientation',
  note: 'Note'
};

const groupedSubLoc = computed(() => {
  return parsedSubLoc.value.reduce((acc, x) => {
    const k = (x.kind || 'location').toLowerCase();
    (acc[k] ||= []).push(x);
    return acc;
  }, {});
});

// STRING: "id;id;..." -> tableau
const stringRefs = computed(() => {
  const raw = protein?.string_refs;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    // supporte "a;b;c" ou JSON "['a','b']"
    if (raw.includes(';')) return raw.split(';').map(s => s.trim()).filter(Boolean);
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(Boolean) : (raw ? [raw] : []);
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
});


const groupedGO = computed(() => {
  return parsedGOTerms.value.reduce((acc, t) => {
    const k = (t.aspect || '').toUpperCase()
    if (!acc[k]) acc[k] = []
    acc[k].push(t)
    return acc
  }, { F: [], P: [], C: [] })
})

// labels + couleurs (on garde)
const ASPECT_INFO = {
  F: { label: 'Molecular function', color: '#3b82f6' },   // bleu
  P: { label: 'Biological process', color: '#22c55e' },   // vert
  C: { label: 'Cellular component', color: '#a855f7' },   // violet
};
const ASPECT_ORDER = ['C', 'F', 'P']; // ordre d’affichage souhaité
const aspectKey = (a) => String(a || '').toUpperCase();
const quickgoUrl = (id) => `https://www.ebi.ac.uk/QuickGO/term/${encodeURIComponent(id)}`;
</script>

<style scoped>
.protein-info {
  padding: 1rem;
  width: 100%;
  overflow: auto;
  align-self: flex-start;
}
h3 { margin-top: 0; }

.protein-info ul { list-style: none; padding:0; margin: 0; }
.protein-info li { margin-bottom: 0.5rem; text-align: left; }

.sequence {
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0.5rem;
  border-radius: 4px;
  background: #3e3e47;
  max-height: 200px;
  overflow: auto;
}
.placeholder { padding: 1rem; width: 300px; margin-top: 30px; color: #777; }
.crosslink-sub { margin-left: 20px; font-size: 0.9em; color: gray; }

.legend { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; font-size: 0.85rem; color: white; }
.legend-color { width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; display: inline-block; }
.legend-color.intra { background-color: orange; }
.legend-color.inter { background-color: purple; }
.legend-color.both { background-color: pink; }

.sequence-header .seq-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.seq-size { color: #ccc; font-style: italic; font-size: 0.9rem; }

/* ---- GO styles ---- */
/* Ligne de séparation légère au-dessus de GO */
.go-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #3a3a43; /* gris léger */
}

/* Résumé par aspect (puces colorées) */
.go-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 8px;
}
.go-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.9rem;
  background: #2f2f37;
  border: 1px solid #3a3a43;
  color: #e6e6e6;
}
.go-chip .dot {
  width: 10px; height: 10px; border-radius: 50%;
  display: inline-block;
  background: currentColor;
}

/* Grille de cartes */
.go-card-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.go-card {
  background: #2f2f37;
  border: 1px solid #3a3a43;
  border-left-width: 4px;           /* ruban latéral coloré */
  border-radius: 8px;
  padding: 8px 10px;
}
.go-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

/* Nouveau libellé d’aspect en haut */
.go-kind {
  font-weight: 700;
  font-size: 0.85rem;
  color: #eaeaea;
  letter-spacing: .02em;
}

.go-id {
  color: #b9d4ff;
  text-decoration: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9rem;
}
.go-id:hover { text-decoration: underline; }

.go-term {
  color: #fff;
  font-weight: 600;
  line-height: 1.2;
}

/* Couleurs par aspect (ruban + puces résumé) */
.aspect-F { border-left-color: #3b82f6; color: #cfe3ff; }
.aspect-P { border-left-color: #22c55e; color: #d9f7e4; }
.aspect-C { border-left-color: #a855f7; color: #ecd7ff; }

.go-chip.aspect-F .dot { background: #3b82f6; }
.go-chip.aspect-P .dot { background: #22c55e; }
.go-chip.aspect-C .dot { background: #a855f7; }

/* — Espacement entre les groupes et entre le titre et les cartes — */
.go-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;                /* plus d'espace entre les catégories */
}

.go-group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;      /* plus d'espace avant la grille de cartes */
}

/* Dot + Titre à gauche, Compteur collé à droite */
.go-group-title {
  margin-right: auto;       /* pousse le compteur à droite */
}
.go-count {
  margin-left: auto;        /* colle à droite */
  font-weight: 700;
  color: #e0e0e0;
  font-variant-numeric: tabular-nums; /* joli alignement des chiffres */
}

/* — Lien GO collé à droite dans la carte — */
.go-card-head {
  display: flex;
  justify-content: flex-end;  /* aligne le contenu à droite */
  align-items: center;
  margin-bottom: 6px;
}
.go-id {
  margin-left: auto;          /* assure le collage à droite même si d'autres éléments arrivent */
}
/* Ligne de séparation légère comme GO */
.sl-section, .string-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #3a3a43;
}

/* résumé chips */
.sl-summary {
  display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 8px;
}
.sl-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 10px; border-radius: 999px; font-size: 0.9rem;
  background: #2f2f37; border: 1px solid #3a3a43; color: #e6e6e6;
}
.sl-chip .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

/* couleurs par catégorie */
.sl-location .dot, .sl-group.sl-location .left .dot { background: #60a5fa; }      /* bleu */
.sl-topology  .dot, .sl-group.sl-topology  .left .dot { background: #f59e0b; }    /* orange */
.sl-orientation .dot, .sl-group.sl-orientation .left .dot { background: #10b981; }/* vert */
.sl-note      .dot, .sl-group.sl-note      .left .dot { background: #a78bfa; }    /* violet */

/* entête de groupe */
.sl-group-head {
  display:flex; align-items:center; justify-content:space-between;
  margin: 4px 0 8px;
  font-weight: 700; color: #eaeaea;
}
.sl-group-head .left { display:flex; align-items:center; gap:8px; }

/* grille cartes */
.sl-card-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.sl-card {
  background: #2f2f37; border: 1px solid #3a3a43; border-radius: 8px; padding: 8px 10px;
}
.sl-card-head {
  display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;
}
.sl-kind { font-weight: 700; font-size: .85rem; color: #eaeaea; }
.sl-id   { color: #b9d4ff; text-decoration: none; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: .9rem; }
.sl-id:hover { text-decoration: underline; }
.sl-term { color:#fff; font-weight:600; line-height:1.2; }

/* evidences */
.sl-ev-list { margin-top:6px; padding-left:18px; }
.sl-ev { color:#cfcfcf; font-size:.9rem; }
.sl-ev code { background:#3a3a43; padding:0 .25rem; border-radius:4px; }

/* STRING chips */
.string-chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.string-chip {
  display:inline-flex; align-items:center; gap:6px;
  padding:4px 10px; border-radius:999px; font-size:.9rem;
  background:#243b55; border:1px solid #3a3a43; color:#dbeafe; text-decoration:none;
}
.string-chip:hover { background:#1f2f45; }




</style>
