<template>
  <div class="graph-toolbar">
    <div class="graph-toolbar-inner">
      <input
          v-model="searchQuery"
          type="text"
          placeholder="Search"
          class="search-input"
          aria-label="Search proteins"
      /> <!-- placeholder="search for a gene name, protein name, uniprot ID, sequence..." -->
      <label class="selflinks">
        <input type="checkbox" v-model="showSelfLinks" />
        Self-Links
      </label>
    </div>
  </div>

  <div class="graph-page">
    <div class="protein-info-container">
      <ProteinInfo :protein="selectedProtein" />
    </div>

    <div class="graph-container">
      <div class="graph-header">
        <h3>Crosslink Graph</h3>
        <div class="organism-line">
          <span  v-if="organismName && organismName.length"> Organism name: {{ organismName }}</span>
          <span v-if="organismTaxon">&nbsp; Taxon ID: {{ organismTaxon }}</span>
        </div>
      </div>

      <div id="cytoscape-wrapper">
        <div ref="cyContainer" class="cytoscape cytoscape-graph"></div>
      </div>
      <div class="total-crosslinks">
        <p>Total crosslinks: {{ totalCrosslinkCount }}</p>
      </div>
    </div>
    <div class="crosslink-table-container">
      <CrosslinkTable
          v-show="selectedProtein && selectedProteinCrosslinks.length"
          :crosslinks="selectedProteinCrosslinks"
          :selectedProtein="selectedProtein"
      />
      <button class="export-btn" @click="exportSvg">Export to SVG</button>

    </div>
  </div>
</template>

<script setup>
import {ref, onMounted, watch, onBeforeUnmount, nextTick, computed} from 'vue'
import { useDataStore } from '@/store/dataStore.js'
import { useRoute } from 'vue-router'
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import CrosslinkTable from '@/components/CrosslinkTable.vue';
import ProteinInfo from '@/components/ProteinInfo.vue'
import {fetchDatasetMeta} from "@/services/datasets.js";
import cytoscapeSvg from 'cytoscape-svg';


cytoscape.use(cytoscapeSvg);
cytoscape.use(coseBilkent);

const props = defineProps({
  refreshTrigger: {
    type: Number,
    default: 0
  }
})

const route = useRoute();
const datasetId = ref(Number(route.params.datasetId));

// References
const organismName = ref('');
const organismTaxon = ref(null);
const cyContainer = ref(null);
let cy = null;

function downloadTextFile (text, filename, mime = 'image/svg+xml;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function exportSvg () {
  if (!cy) return;
  const svgStr = cy.svg({
    full: true,   // tout le graphe (pas seulement le viewport)
    scale: 1,
    // bg: 'white', // décommente si tu veux un fond blanc
  });
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  downloadTextFile(svgStr, `cytoscape-graph-${ts}.svg`);
}


const store = useDataStore();

const selectedProtein = ref(null)
const selectedProteinCrosslinks = ref([]);

const totalCrosslinkCount = ref(0);

const searchQuery = ref('');
const filteredProteinIds = ref([]);

const fastaMap = new Map();
const edgeMap = new Map();
const degreeMap = new Map();
let minDegree = 0, maxDegree = 1;

let lastFriseNodeId = null;
let lastFriseForProtein = null;
const showSelfLinks = ref(true);


// ===== Utils =====
const normalizeWidth = (count, min, max) => {
  const minWidth = 2, maxWidth = 8;
  if (min === max) return (minWidth + maxWidth) / 2;
  return minWidth + ((count - min) / (max - min)) * (maxWidth - minWidth);
};

const normalizeSize = (degree, min, max) => {
  const minSize = 20, maxSize = 60;
  if (max === min) return minSize;
  return minSize + ((degree - min) / (max - min)) * (maxSize - minSize);
};

const forceCanvasAlignment = () => {
  if (!cy || !cyContainer.value) return;

  const canvases = cyContainer.value.querySelectorAll('canvas');
  canvases.forEach(canvas => {
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.transform = 'none';
  });
};

function recreateGlobalEdges() {
  const edgeCounts = Array.from(edgeMap.values()).map(e => e.count);
  const [minCount, maxCount] = [Math.min(...edgeCounts), Math.max(...edgeCounts)];

  const edges = Array.from(edgeMap.values()).map((edgeData, i) => ({
    group: 'edges',
    data: {
      id: `link-${i}`,
      source: edgeData.source,
      target: edgeData.target,
      label: '',
      width: normalizeWidth(edgeData.count, minCount, maxCount)
    }
  }));

  cy.add(edges);
}

function buildGraphData() {
  fastaMap.clear();
  edgeMap.clear();
  degreeMap.clear();

  const fastaData = store.fastaData;
  const csvData = store.csvData;

  if (!fastaData.length || !csvData.length) {
    console.warn('No data loaded');
    return { nodes: [], edges: [] };
  }

  fastaData.forEach(p => {
    if (!p?.uniprot_id) {
      console.warn("Missing uniprot_id in entry:", p);
      return;
    }
    fastaMap.set(p.uniprot_id.toUpperCase(), p);
  });

  //fastaData.forEach(p => fastaMap.set(p.uniprot_id.toUpperCase(), p));

  const involvedProteinIds = new Set();

  const validLinks = csvData.filter(link => {
    const source = (link.Protein1 || '').trim().toUpperCase();
    const target = (link.Protein2 || '').trim().toUpperCase();
    return source && target && fastaMap.has(source) && fastaMap.has(target);
  });

  totalCrosslinkCount.value = validLinks.length;

  validLinks.forEach(link => {
    const source = (link.Protein1 || '').trim().toUpperCase();
    const target = (link.Protein2 || '').trim().toUpperCase();
    if (!source || !target) return;

    involvedProteinIds.add(source);
    involvedProteinIds.add(target);

    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { source, target, count: 1 });
    } else {
      edgeMap.get(key).count++;
    }
  });

  // Calcul des degrés
  fastaData.forEach(p => degreeMap.set(p.uniprot_id.toUpperCase(), 0));
  edgeMap.forEach(({ source, target, count }) => {
    degreeMap.set(source, (degreeMap.get(source) || 0) + count);
    degreeMap.set(target, (degreeMap.get(target) || 0) + count);
  });

  const degrees = Array.from(degreeMap.values());
  [minDegree, maxDegree] = [Math.min(...degrees), Math.max(...degrees)];

  const nodes = Array.from(involvedProteinIds)
      .filter(id => {
        if (!fastaMap.has(id)) return false;
        if (filteredProteinIds.value.length > 0) {
          return filteredProteinIds.value.includes(id);
        }
        return true;
      })
      .map(id => {
        const size = normalizeSize(degreeMap.get(id), minDegree, maxDegree);
        const fastaEntry = fastaMap.get(id);
        const label = fastaEntry?.gene_name || id;
        return {
          data: { id, label, size }
        };
      });

  const edgeCounts = Array.from(edgeMap.values()).map(e => e.count);
  const [minCount, maxCount] = [Math.min(...edgeCounts), Math.max(...edgeCounts)];

  const edges = Array.from(edgeMap.values())
      .filter(({ source, target }) => {
        if (filteredProteinIds.value.length === 0) return true;
        return filteredProteinIds.value.includes(source) && filteredProteinIds.value.includes(target);
      })
      .map((edgeData, i) => ({
        data: {
          id: `link-${i}`,
          source: edgeData.source,
          target: edgeData.target,
          label: '',
          width: normalizeWidth(edgeData.count, minCount, maxCount)
        }
      }));

  return { nodes, edges };
}

// ===== Graph =====
const generateGraph = async () => {
  if (cy) {
    cy.destroy();
    cy = null;
  }

  const { nodes, edges } = buildGraphData();
  await nextTick();

  // Initialiser Cytoscape
  cy = cytoscape({
    container: cyContainer.value,
    elements: [...nodes, ...edges],
    layout: {
      name: 'cose-bilkent',
      animate: 'end',
      componentSpacing: 200,
      animationDuration: 1000,
      fit: false,
      padding: 100,
      randomize: false,
      nodeRepulsion: 45000,            // Augmente l'espacement entre nœuds
      idealEdgeLength: 150,            // Longueur cible des liens
      edgeElasticity: 0.4,             // Souplesse des liens
      nestingFactor: 0.9,              // Compacité des clusters
      gravity: 0.25,                   // Gravité vers le centre
      numIter: 3000,
      tile: true,
      tilingPaddingVertical: 10,
      tilingPaddingHorizontal: 10,
    },
    style: [
      {
        selector: 'node[label]',
        style: {
          label: 'data(label)',
          'background-color': '#0074D9',
          'text-valign': 'center',
          color: '#fff',
          'text-outline-width': 2,
          'text-outline-color': '#0074D9',
          width: 'data(size)',
          height: 'data(size)'
        }
      },
      {
        selector: 'edge[type="inter"]',
        style: {
          'line-color': '#c819fd',
          width: 1.5,
          label: 'data(label)',
          'font-size': 8,
          'text-rotation': 'autorotate',
          'curve-style': 'bezier'
        }
      },
      {
        selector: 'edge[type="intra"]',
        style: {
          'curve-style': 'unbundled-bezier',
          'control-point-distance': 30,
          'control-point-weight': 0.5,
          'loop-direction': -45,
          'loop-sweep': 60,
          'line-color': '#f39c12',
          'target-arrow-shape': 'none',
          label: 'data(abs1)',
          'font-size': 6,
          'text-margin-y': -10
        }
      },
      {
        selector: 'edge[type="intra"], edge[type="inter"]',
        style: {
          'label': '',
          'text-opacity': 0
        }
      },
      {
        selector: 'node[type="frise"]',
        style: {
          shape: 'rectangle',
          width: 'data(sequenceLength)',
          height: 50,
          'background-color': '#000',
          'background-opacity': 0.15,
          'border-color': '#aaa',
          'border-width': 2.5,
          label: 'data(label)',
          'text-valign': 'center',
          'text-halign': 'left',
          'text-margin-x': -10,
          color: '#fff',
          'font-size': 10
        }
      },
      {
        selector: 'node.matched',
        style: {
          'background-color': 'green',
          'text-outline-color': 'green'
        }
      },
      {
        selector: 'node.ghost',
        style: {
          width: 0.1,
          height: 0.1,
          opacity: 0,
          'background-opacity': 0,
          'events': 'no',
        }
      },
      {
        selector: 'edge.flag-head',
        style: {
          'curve-style': 'straight',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#f0a31a',
          'arrow-scale': 1.5,
          'line-color': '#f0a31a',
          'width': 2,
          'events': 'no',

        }
      },
      {
        selector: 'edge.flag-mast',
        style: {
          'curve-style': 'straight',
          'line-color': '#f0a31a',
          'width': 1.5,
          'target-arrow-shape': 'none',
          'events': 'no',

        }
      },
      {
        selector: 'node.frise-highlight',
        style: {
          'overlay-color': 'limegreen',
          'overlay-padding': '6px',
          'overlay-opacity': 0.3
        }
      },
      {
        selector: 'node.tick-label',
        style: {
          'background-opacity': 0,
          'text-outline-width': 0,
          'color': '#ccc',
          'font-size': 6,
          'text-valign': 'top',
          'text-halign': 'center',
          'shape': 'none',
          'width': 1,
          'height': 1
        }
      },
      {
        selector: 'edge.tick-mark',
        style: {
          'line-color': '#aaa',
          'width': 0.8,
          'curve-style': 'straight',
          'opacity': 0.8
        }
      }
    ]
  });

  cy.ready(() => {
    forceCanvasAlignment();

    setTimeout(() => {
      forceCanvasAlignment();
      cy.resize();
      const baseZoom = 0.31;
      const zoomFactor = cy.nodes().length < 50 ? 1.5 : 1.1;
      cy.zoom(baseZoom * zoomFactor);
      const offsetX = cy.width() / 2;
      const offsetY = cy.height() / 2;
      cy.pan({ x: offsetX, y: offsetY });
    }, 100);

    cy.on('dragfree', 'node', evt => {
      const dragged = evt.target;

      // Si aucun noeud sélectionné, on quitte
      if (!selectedProtein.value || !selectedProtein.value.uniprot_id) return;

      const selected = selectedProtein.value.uniprot_id.toUpperCase();
      const friseNode = cy.getElementById('frise-node');

      // Si le nœud déplacé est le nœud original (désormais supprimé), on ne fait rien
      if (dragged.data('id') !== selected) return;

      // Sinon, mettre à jour la position de la frise si elle existe
      if (friseNode.nonempty()) {
        const pos = dragged.position();
        friseNode.position({
          x: pos.x,
          y: pos.y
        });
      }
    });
  });

  cy.on('tap', 'node', evt => {
    evt.preventDefault?.();

    const currentFilter = filteredProteinIds.value.length > 0 ? new Set(filteredProteinIds.value.map(id => id.toUpperCase())) : null;

    cy.nodes().forEach(n => {
      const id = n.id().toUpperCase();
      const baseId = id.startsWith('FRISE-') ? id.replace('FRISE-', '') : id;
      const visible = !currentFilter || currentFilter.has(baseId);

      const degree = degreeMap.get(id) || 1;
      const size = normalizeSize(degree, minDegree, maxDegree);
      n.style({
        display: visible ? 'element' : 'none',
        width: size,
        height: size,
        opacity: visible ? 1 : 0.1
      });
    });

    cy.edges().forEach(e => {
      const source = e.data('source').toUpperCase();
      const target = e.data('target').toUpperCase();
      const parent = (e.data('friseParent') || '').replace('FRISE-', '').toUpperCase();
      const visible = !currentFilter || (currentFilter.has(source) && currentFilter.has(target)) || currentFilter.has(parent);
      e.style({
        display: visible ? 'element' : 'none',
        opacity: visible ? 1 : 0.05
      });
    });

    const node = evt.target;
    const rawId = node.data('id');
    // Ignore ghost nodes
    if (rawId.startsWith('ghost-') || rawId.startsWith('flag-')) {
      return;
    }
    const isFrise = rawId.startsWith('frise-');
    const id = isFrise ? rawId.replace('frise-', '') : rawId;

    //fermeture frise
    if (isFrise) {
      const friseNode = cy.getElementById(rawId);
      if (friseNode.nonempty()) {
        const pos = friseNode.position();

        // Supprimer tous les edges liés à cette frise
        cy.edges().filter(e =>
            ['intra', 'inter', 'flag'].includes(e.data('type')) &&
            (e.data('source') === rawId || e.data('target') === rawId)
        ).remove();

        // Supprimer tous les ghost/flag nodes liés
        cy.nodes().filter(n =>
            n.data('friseParent') === rawId ||
            n.classes().includes('ghost') && n.id().startsWith(`ghost-${id}-`) ||            n.id().startsWith(`flag-${id}-`) ||
            n.id().startsWith(`flag-${id}-`) ||
            n.id().startsWith(`flag-top-${id}-`) ||
            n.id().startsWith(`flag-tip-${id}-`)
        ).remove();

        cy.edges().filter(e =>
            e.data('friseParent') === rawId ||
            e.id().startsWith('flag-mast-') ||
            e.id().startsWith('flag-head-')
        ).remove();

        cy.nodes().filter(n =>
            n.id().startsWith(`tick-${id}-`)
        ).remove();


        // Supprimer le nœud frise
        cy.remove(friseNode);

        // Restaurer le nœud protéine original
        const fastaEntry = store.fastaData.find(p => p.uniprot_id.toUpperCase() === id);
        const degree = degreeMap.get(id) || 1;
        const size = normalizeSize(degree, minDegree, maxDegree);
        const label = fastaEntry?.gene_name || id;

        if (filteredProteinIds.value.length > 0 && !filteredProteinIds.value.includes(id)) {
          return; // ne restaure pas le nœud si pas dans recherche
        }

        cy.add({
          group: 'nodes',
          data: { id, label, size },
          position: pos
        });

        // Recréer les edges globaux normaux
        recreateGlobalEdges();

        selectedProtein.value = null;
        selectedProteinCrosslinks.value = [];
        lastFriseNodeId = null;
        lastFriseForProtein = null;
      }
      // Restaurer visibilité normale
      cy.nodes().forEach(n => {
        n.style({
          opacity: 1,
          'text-opacity': 1
        });
      });
      cy.edges().forEach(e => {
        e.style({
          opacity: 1
        });
      });

      return;
    }

    const fasta = store.fastaData.find(p => p.uniprot_id.toUpperCase() === id);
    if (!fasta || !fasta.sequence) {
      console.warn(`Sequence not found for ${id}`);
      return;
    }

    selectedProtein.value = fasta;

    // 1. Filtrer les lignes du CSV impliquant la protéine sélectionnée
    let links = store.csvData.filter(link => {
      const p1 = (link.Protein1 || '').trim().toUpperCase();
      const p2 = (link.Protein2 || '').trim().toUpperCase();
      if (!p1 || !p2) return false;
      return p1 === id || p2 === id;
    });

// 2. Supprimer les doublons identiques sur la même protéine et positions
    const seen = new Map();

    links.forEach(link => {
      const p1 = (link.Protein1 || '').trim().toUpperCase();
      const p2 = (link.Protein2 || '').trim().toUpperCase();
      const abs1 = parseInt(link.AbsPos1);
      const abs2 = parseInt(link.AbsPos2);
      const score = parseFloat(link.Score) || 0;
      if (!p1 || !p2 || isNaN(abs1) || isNaN(abs2)) return;
      const protA = p1 < p2 ? p1 : p2;
      const protB = p1 < p2 ? p2 : p1;
      const posA = abs1 < abs2 ? abs1 : abs2;
      const posB = abs1 < abs2 ? abs2 : abs1;

      const key = `${protA}|${protB}|${posA}|${posB}`;

      if (!seen.has(key) || seen.get(key).score < score) {
        seen.set(key, {
          Protein1: p1,
          Protein2: p2,
          AbsPos1: abs1,
          AbsPos2: abs2,
          Score: score,
        });
      }
    });

// Trier par paire de protéines (ordre alpha)
    selectedProteinCrosslinks.value = Array.from(seen.values()).sort((a, b) => {
      const keyA = [a.Protein1, a.Protein2].sort().join('|');
      const keyB = [b.Protein1, b.Protein2].sort().join('|');
      return keyA.localeCompare(keyB);
    });



    // Si une frise est déjà affichée, restaurer son nœud d'origine

    if (lastFriseNodeId && lastFriseForProtein && lastFriseForProtein !== id) {
      const oldFasta = store.fastaData.find(p => p.uniprot_id.toUpperCase() === lastFriseForProtein);
      const oldFriseNode = cy.getElementById(lastFriseNodeId);

      if (oldFasta && oldFriseNode.nonempty()) {
        const pos = oldFriseNode.position();

        // 🔥 Supprimer tous les edges intra, inter, flag liés à cette frise
        cy.edges().filter(e =>
            ['intra', 'inter', 'flag'].includes(e.data('type')) &&
            e.data('friseParent') === lastFriseNodeId
        ).remove();

        cy.nodes().filter(n =>
            n.data('friseParent') === lastFriseNodeId ||
            n.id().startsWith(`flag-${lastFriseForProtein}-`) ||
            n.id().startsWith(`flag-top-${lastFriseForProtein}-`) ||
            n.id().startsWith(`flag-tip-${lastFriseForProtein}-`)
        ).remove();

        cy.edges().filter(e =>
            e.data('friseParent') === lastFriseNodeId ||
            e.id().startsWith('flag-mast-') ||
            e.id().startsWith('flag-head-')
        ).remove();

        // Supprimer le noeud frise
        cy.remove(oldFriseNode);

        // 🔁 Restaurer le noeud protéine original
        const degree = degreeMap.get(lastFriseForProtein) || 1;
        const size = normalizeSize(degree, minDegree, maxDegree);
        const label = oldFasta?.gene_name || lastFriseForProtein;

        cy.add({
          group: 'nodes',
          data: { id: lastFriseForProtein, label, size },
          position: pos
        });

        recreateGlobalEdges();

        lastFriseNodeId = null;
        lastFriseForProtein = null;
      }
    }


    cy.remove(`node[id="${id}"]`);


    const sequenceLength = fasta.sequence.length;
    const pxPerAA = 0.5;
    const friseWidth = sequenceLength * pxPerAA;
    const friseNodeId = `frise-${id}`;
    const label = fasta?.gene_name;
    // Ajouter le nœud frise
    cy.add({
      group: 'nodes',
      data: {
        id: friseNodeId,
        label,
        type: 'frise',
        proteinId: id,
        sequenceLength: friseWidth
      },
      position: {
        x: node.position().x,
        y: node.position().y
      },
      grabbable: true,
      selectable: true
    });
    const labelStep = 100;

    for (let i = 1; i <= sequenceLength; i++) {
      if (i === 1 || i % labelStep === 0){

        const tickId = `tick-${id}-${i}`;
        const x = node.position().x - friseWidth / 2 + i * pxPerAA;

        cy.add({
          group: 'nodes',
          data: {
            id: tickId,
            label: `${i}`,
            friseParent: `frise-${id}`
          },
          position: { x: x, y: node.position().y + 35 },  // ⬅️ SOUS la frise
          grabbable: false,
          selectable: false,
          classes: 'tick-label'
        });
        const tickMarkId = `tick-mark-${id}-${i}`;
        const markStartId = `tick-ghost-start-${id}-${i}`;
        const markEndId = `tick-ghost-end-${id}-${i}`;
        const markX = x;
        const markY1 = node.position().y + 20; // Bas de la frise
        const markY2 = node.position().y + 25; // Trait de 5px

        // Ajoute deux points invisibles pour tracer le trait de la graduation
        cy.add([
          {
            group: 'nodes',
            data: { id: markStartId, friseParent: `frise-${id}` },
            position: { x: markX, y: markY1 },
            grabbable: false,
            selectable: false,
            classes: 'ghost'
          },
          {
            group: 'nodes',
            data: { id: markEndId, friseParent: `frise-${id}` },
            position: { x: markX, y: markY2 },
            grabbable: false,
            selectable: false,
            classes: 'ghost'
          },
          {
            group: 'edges',
            data: {
              id: tickMarkId,
              source: markStartId,
              target: markEndId,
              friseParent: `frise-${id}`
            },
            classes: 'tick-mark'
          }
        ]);

      }
    }
    // Atténuer les autres éléments
    cy.nodes().forEach(n => {
      if (!n.id().startsWith(`frise-${id}`) &&
          !n.id().startsWith(`ghost-${id}-`) &&
          n.id() !== id &&
          !n.id().startsWith(`flag-`)) {
        n.style({
          opacity: 0.3,
          'text-opacity': 2, // Garder les labels lisibles
          'background-opacity': 0.5
        });
      }
    });
    cy.edges().forEach(e => {
      if (!['intra', 'inter', 'flag'].includes(e.data('type')) || e.data('friseParent') !== `frise-${id}`) {
        e.style({
          opacity: 0.4
        });
      }
    });

// S'assurer que le nœud frise est au premier plan
    const friseNode = cy.getElementById(`frise-${id}`);
    if (friseNode.nonempty()) {
      const json = friseNode.json();
      cy.remove(friseNode);
      cy.add(json); // réinjection = top-layer
    }
    const position = friseNode.position();

    //pour que la graduation suive la dfr
    cy.on('position', 'node[type="frise"]', evt => {
      const frise = evt.target;
      const friseId = frise.id();
      const friseX = frise.position('x');
      const friseY = frise.position('y');
      const friseWidth = frise.width(); // largeur actuelle de la frise
      const pxPerAA = 0.5;

      // Met à jour les ticks
      cy.nodes().filter(n =>
          n.data('friseParent') === friseId &&
          n.hasClass('tick-label')
      ).forEach(tick => {
        const residueNumber = parseInt(tick.data('label'));
        const offsetX = (residueNumber * pxPerAA) - friseWidth / 2;
        const x = friseX + offsetX;
        const y = friseY + 35; // sous la frise
        tick.position({ x, y });
      });

      // Met à jour les traits tick-mark
      cy.edges().filter(e => e.hasClass('tick-mark') && e.data('friseParent') === friseId).forEach(e => {
        const i = parseInt(e.id().split('-').pop());
        const offsetX = (i * pxPerAA) - friseWidth / 2;
        const markX = friseX + offsetX;
        const markY1 = friseY + 20;
        const markY2 = friseY + 25;

        const start = cy.getElementById(`tick-ghost-start-${id}-${i}`);
        const end = cy.getElementById(`tick-ghost-end-${id}-${i}`);
        start.position({ x: markX, y: markY1 });
        end.position({ x: markX, y: markY2 });
      });

    });


    cy.on('position', 'node[id="' + friseNodeId + '"]', e => {
      const newPos = e.target.position();

      store.csvData.forEach(link => {
        const p1 = (link.Protein1 || '').trim().toUpperCase();
        const p2 = (link.Protein2 || '').trim().toUpperCase();
        const pos1 = parseInt(link.AbsPos1);
        const pos2 = parseInt(link.AbsPos2);

        if (!p1 || !p2 || isNaN(pos1) || isNaN(pos2)) return;

        if (p1 === id && p2 === id) {
          const ghost1 = cy.getElementById(`ghost-${id}-${pos1}`);
          const ghost2 = cy.getElementById(`ghost-${id}-${pos2}`);
          const x1 = newPos.x - friseWidth / 2 + pos1 * pxPerAA;
          const x2 = newPos.x - friseWidth / 2 + pos2 * pxPerAA;
          if (ghost1.nonempty()) ghost1.position({ x: x1, y: newPos.y });
          if (ghost2.nonempty()) ghost2.position({ x: x2, y: newPos.y });
        }

        if ((p1 === id && p2 !== id) || (p2 === id && p1 !== id)) {
          const pos = p1 === id ? pos1 : pos2;
          const ghost = cy.getElementById(`ghost-${id}-${pos}`);
          const x = newPos.x - friseWidth / 2 + pos * pxPerAA;
          if (ghost.nonempty()) ghost.position({ x, y: newPos.y });
        }

        if (pos1 === pos2 && (p1 === id || p2 === id)) {
          const flag = cy.getElementById(`flag-${id}-${pos1}`);
          if (flag.nonempty()) {
            const x = newPos.x - friseWidth / 2 + pos1 * pxPerAA;
            flag.position({ x, y: newPos.y });
          }
        }
      });

      // 🔁 Mise à jour des drapeaux associés
      cy.nodes('.flag').forEach(flagNode => {
        if (flagNode.data('friseParent') !== `frise-${id}`) return;

        const flagPos = parseInt(flagNode.id().split('-').at(-1));
        const newX = newPos.x - friseWidth / 2 + flagPos * pxPerAA;

        if (flagNode.id().startsWith(`flag-top-`)) {
          flagNode.position({ x: newX, y: newPos.y - 40 });
        } else if (flagNode.id().startsWith(`flag-tip-`)) {
          flagNode.position({ x: newX + 12.2, y: newPos.y - 40 });
        } else {
          flagNode.position({ x: newX, y: newPos.y });
        }
      });

    });

    lastFriseNodeId = friseNodeId;
    lastFriseForProtein = id;
    const edgeSeen = new Set();

    // Créer edges "virtuels" pour visualiser les crosslinks
    store.csvData.forEach((link, i) => {
      const p1 = (link.Protein1 || '').trim().toUpperCase();
      const p2 = (link.Protein2 || '').trim().toUpperCase();
      const pos1 = parseInt(link.AbsPos1);
      const pos2 = parseInt(link.AbsPos2);

      if (!p1 || !p2 || isNaN(pos1) || isNaN(pos2)) {
        //console.warn(`[SKIP] Crosslink invalide: p1=${p1}, p2=${p2}, pos1=${pos1}, pos2=${pos2}`);
        return;
      }
      const key = [p1, p2, pos1, pos2].sort().join('|');
      if (edgeSeen.has(key)) return;
      edgeSeen.add(key);

      const pxPerAA = 0.5;
      if ((p1 === p2) && !showSelfLinks.value) return;  // Skip self-links

      // Crosslink Intra
      if (p1 === id && p2 === id) {
        //position 1 et 2 identique
        if (pos1 === pos2) {
          const flagId = `flag-${id}-${pos1}`;
          const ghostTopId = `flag-top-${id}-${pos1}`;
          const flagTipId = `flag-tip-${id}-${pos1}`;


          const x = position.x - friseWidth / 2 + pos1 * pxPerAA;
          const y = position.y;

          if (cy.getElementById(flagId).length === 0) {
            cy.add({
              group: 'nodes',
              data: {
                id: flagId,
                friseParent: `frise-${id}`
              },
              position: { x, y },
              grabbable: false,
              selectable: false,
              classes: 'ghost flag'
            });
          }

          if (cy.getElementById(ghostTopId).length === 0) {
            cy.add({
              group: 'nodes',
              data: {
                id: ghostTopId,
                friseParent: `frise-${id}`
              },
              position: { x, y: y - 40 },
              grabbable: false,
              selectable: false,
              classes: 'ghost flag'
            });
          }

          if (cy.getElementById(flagTipId).length === 0) {
            cy.add({
              group: 'nodes',
              data: {
                id: flagTipId,
                friseParent: `frise-${id}`
              },
              position: { x: x + 12.2, y: y - 40 },
              grabbable: false,
              selectable: false,
              classes: 'ghost flag'
            });
          }

          cy.add({
            group: 'edges',
            data: {
              id: `flag-mast-${i}`,
              source: flagId,
              target: ghostTopId,
              friseParent: `frise-${id}`
            },
            classes: 'crosslink flag-mast'
          });

          cy.add({
            group: 'edges',
            data: {
              id: `flag-head-${i}`,
              source: ghostTopId,
              target: flagTipId,
              friseParent: `frise-${id}`
            },
            classes: 'crosslink flag-head'
          });

          return;
        }

        // position 1 et 2 diff
        else {
          const ghostId1 = `ghost-${id}-${pos1}`;
          const ghostId2 = `ghost-${id}-${pos2}`;
          const x1 = position.x - friseWidth / 2 + pos1 * pxPerAA;
          const x2 = position.x - friseWidth / 2 + pos2 * pxPerAA;

// Ajout des deux noeuds invisibles si nécessaires
          if (cy.getElementById(ghostId1).length === 0) {
            cy.add({
              group: 'nodes',
              data: { id: ghostId1, friseParent: `frise-${id}` },
              position: { x: x1, y: position.y },
              grabbable: false,
              selectable: false,
              classes: 'ghost',
            });
          }

          if (cy.getElementById(ghostId2).length === 0) {
            cy.add({
              group: 'nodes',
              data: { id: ghostId2, friseParent: `frise-${id}` },
              position: { x: x2, y: position.y },
              grabbable: false,
              selectable: false,
              classes: 'ghost',
            });
          }

          const rawDx = Math.abs(x2 - x1); // distance brute en px

// 🔁 Normalisation logarithmique pour écraser les grandes distances
          const normalizedDx = Math.log2(rawDx + 10); // +10 pour éviter log(0)
          const arcHeight = -normalizedDx * 25; // facteur d’échelle à ajuster

// Ajout de l’arche (arc de cercle) entre les deux positions
          cy.add({
            group: 'edges',
            data: {
              id: `intra-${i}`,
              source: ghostId1,
              target: ghostId2,
              type: 'intra',
              abs1: pos1,
              abs2: pos2,
              friseParent: `frise-${id}`
            },
            style: {
              'curve-style': 'unbundled-bezier',
              'control-point-distances': [arcHeight],
              'control-point-weights': [0.5],
              'line-color': '#f0a31a',
              'width': 1,
              'target-arrow-shape': 'none'
            },
            classes: 'crosslink'
          });
        }

      }
      // Inter
      if ((p1 === id && p2 !== id) || (p2 === id && p1 !== id)) {
        const pos = p1 === id ? pos1 : pos2;
        const targetId = p1 === id ? p2 : p1;
        const ghostId = `ghost-${id}-${pos}`;

        const friseNode = cy.getElementById(`frise-${id}`);
        const frisePos = friseNode.nonempty() ? friseNode.position() : position; // fallback
        const x = frisePos.x - friseWidth / 2 + pos * pxPerAA;
        const y = frisePos.y;



        console.log(`[ADD] Preparation of ghost node: ${ghostId}`);
        console.log(`       Frise position: (${frisePos.x}, ${frisePos.y})`);
        console.log(`       Calculated for absolute position ${pos} => x=${x}, y=${y}`);

        // Ajouter un noeud invisible si pas déjà là
        if (cy.getElementById(ghostId).length === 0) {
          cy.add({
            group: 'nodes',
            data: { id: ghostId,friseParent: `frise-${id}`},
            position: { x, y },
            grabbable: false,
            selectable: false,
            classes: 'ghost',

          });

          const added = cy.getElementById(ghostId);
          console.log(`[ADD] Ghost added: ${ghostId} | Real position:`, added.position());
        }

        const targetNode = cy.getElementById(targetId);
        if (targetNode.nonempty()) {
          cy.add({
            group: 'edges',
            data: {
              id: `inter-${i}`,
              source: ghostId,
              target: targetId,
              type: 'inter',
              abs: pos,
              label: '',
              friseParent: `frise-${id}`
            },
            position: { x, y },
            classes: 'crosslink'
          });
          console.log(`[ADD] Edge inter: ${ghostId} ➝ ${targetId}`);
        }
      }
    });
  });

  cy.on('position', 'node', evt => {
    const node = evt.target;
    const id = node.id();

    // Ignore ghost/frise nodes
    if (id.startsWith('ghost-') || id.startsWith('frise-') || id.startsWith('flag-')) return;

    const pos = node.position();

    // Met à jour tous les ghost nodes associés à cette protéine
    cy.nodes().forEach(n => {
      if (!n.id().startsWith(`ghost-${id}-`)) return;

      const posAA = parseInt(n.id().split('-').at(-1));  // extrait le AbsPos
      const pxPerAA = 0.5;
      const friseWidth = (store.fastaData.find(p => p.uniprot_id.toUpperCase() === id)?.sequence.length || 0) * pxPerAA;
      const newX = pos.x - friseWidth / 2 + posAA * pxPerAA;
      const newY = pos.y;

      n.position({ x: newX, y: newY });
    });
  });

}

function filterGraph(query) {
  if (!cy) return;

  const matchedProteins = query
      ? store.fastaData.filter(p => {
        const fields = [
          p.uniprot_id,
          p.protein_name,
          p.gene_name,
          p.organism,
          p.organism_id,
          p.sequence
        ];
        return fields.some(field =>
            typeof field === 'string' && field.toLowerCase().includes(query)
        );
      })
      : store.fastaData;

  const matchedIds = new Set(matchedProteins.map(p => p.uniprot_id.toUpperCase()));
  const linkedIds = new Set();

  store.csvData.forEach(link => {
    const p1 = (link.Protein1 || '').trim().toUpperCase();
    const p2 = (link.Protein2 || '').trim().toUpperCase();
    if (matchedIds.has(p1)) linkedIds.add(p2);
    if (matchedIds.has(p2)) linkedIds.add(p1);
  });

  const finalVisibleIds = new Set([...matchedIds, ...linkedIds]);
  filteredProteinIds.value = Array.from(finalVisibleIds);

// 🔁 Mêmes boucles cy.nodes() et cy.edges() que maintenant, elles seront appelées même sans recherche.

  //Affichage et marquage des nœuds
  cy.nodes().forEach(node => {
    const id = node.id().toUpperCase();

    // Frise ou node normal
    const rawId = id.startsWith('FRISE-') ? id.replace('FRISE-', '') : id;

    const visible = finalVisibleIds.has(rawId);
    node.style('display', visible ? 'element' : 'none');

    // Mettre en évidence uniquement les protéines directement matchées
    if (query && matchedIds.has(rawId)) {
      if (id.startsWith('FRISE-')) {
        node.addClass('frise-highlight');
      } else {
        node.addClass('matched');
      }
    } else {
      node.removeClass('matched');
      node.removeClass('frise-highlight');
    }

  });


  //Affichage des arêtes uniquement si les deux extrémités sont visibles
  cy.edges().forEach(edge => {
    const source = edge.data('source')?.toUpperCase();
    const target = edge.data('target')?.toUpperCase();
    const friseParent = (edge.data('friseParent') || '').replace('FRISE-', '').toUpperCase();

    const isSelfLink = source === target;
    const bothVisible = finalVisibleIds.has(source) && finalVisibleIds.has(target);
    const friseMatched = matchedIds.has(friseParent);

    const visible = (!isSelfLink || showSelfLinks.value) && (bothVisible || friseMatched);

    edge.style('display', visible ? 'element' : 'none');
  });


}

// ===== Resize handler =====
const handleResize = () => {
  if (cy) {
    cy.resize();
    cy.fit();
    cy.center();
  }
};

// ===== Lifecycle =====
onMounted(async () => {
  if (Number.isFinite(datasetId.value)) {
    await store.loadDataset(datasetId.value);
  }
  try {
    const meta = await fetchDatasetMeta(datasetId.value);
    organismTaxon.value = meta?.organism?.taxon_id ?? null;
    organismName.value  = meta?.organism?.name || meta?.organism?.common_name || '';
  } catch {}

  await generateGraph();
  window.addEventListener('resize', handleResize);
  if (cy) {
    cy.resize();
    cy.fit();
  }
});

watch(searchQuery, (newQuery) => {
  console.log(newQuery);
  filterGraph(newQuery.trim().toLowerCase());
});

watch(showSelfLinks, () => {
  filterGraph(searchQuery.value.trim().toLowerCase());
});


watch(() => props.refreshTrigger, () => {
  generateGraph()
})


onBeforeUnmount(() => {
  if(cy) cy.destroy();
  window.removeEventListener('resize', handleResize);
});

watch(() => route.params.datasetId, async (newVal) => {
  const id = Number(newVal);
  if (!Number.isFinite(id)) return;
  datasetId.value = id;
  try {
    const meta = await fetchDatasetMeta(id);
    organismTaxon.value = meta?.organism?.taxon_id ?? null;
    organismName.value  = meta?.organism?.name || meta?.organism?.common_name || '';
  } catch {}
  await generateGraph();
});
</script>

<style scoped >

/* 3 colonnes en flex, le centre doit grandir */
.graph-page {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 16px;
  width: 100%;                 /* surtout pas 100vw */
  height: calc(100vh - 120px); /* ajuste selon la hauteur de ta navbar */
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Gauche : ProteinInfo — peut rétrécir si manque de place */
.protein-info-container {
  order: 1;
  flex: 1 1 300px;             /* ⬅️ shrink/expand autorisés, base 300px */
  min-width: 260px;
  max-width: 380px;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  margin: 0;
  padding: 0.25rem 0.5rem 0.25rem 0;
}

/* Centre : Graphe — récupère la majorité de l'espace */
.graph-container {
  order: 2;
  flex: 2 1 0;                 /* ⬅️ ratio 2 pour que le centre soit plus large */
  min-width: 600px;            /* évite qu'il devienne trop étroit */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  padding: 0.25rem 0.5rem;
}

/* Zone Cytoscape full-size */
#cytoscape-wrapper { position: relative; width: 100%; height: 100%; }
.cytoscape-graph   { width: 100%; height: 100%; border: 3px solid #ccc; transform-style: preserve-3d; }
.cytoscape-graph canvas { left: 0 !important; }

/* Droite : CrosslinkTable — visible en entier si possible, scroll sinon */
.crosslink-table-container {
  order: 3;
  flex: 1 1 340px;             /* ⬅️ shrink/expand autorisés, base 340px */
  min-width: 300px;
  max-width: 460px;
  height: 100%;
  overflow: auto;              /* scroll vertical ET horizontal si nécessaire */
  box-sizing: border-box;
  margin: 0;
  padding: 0.25rem 0 0.25rem 0.5rem;
}

/* Si ton tableau est étroit, force un min-width pour voir toutes les colonnes */
.crosslink-table-container table {
  width: 100%;
  min-width: 520px;            /* ajuste selon tes colonnes */
  table-layout: auto;
}

/* Responsive : sous 1200px on empile pour ne rien couper */
@media (max-width: 1200px) {
  .graph-page { flex-direction: column; height: auto; }
  .protein-info-container,
  .crosslink-table-container { flex: 0 0 auto; width: 100%; max-width: none; }
  .graph-container { min-width: 0; height: 70vh; }
}

/* (optionnel) sur très grands écrans, donne encore plus au graphe */
@media (min-width: 1600px) {
  .graph-container { flex: 3 1 0; }
}

/* Barre contenant search + checkbox */
.graph-toolbar {
  /* centre le contenu mais autorise un défilement horizontal si trop large */
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 4px 0;                 /* petit respiro vertical */
  text-align: center;             /* centre le bloc inner */
}

.graph-toolbar-inner {
  display: inline-flex;           /* permet le centrage via text-align */
  align-items: center;
  gap: 12px;
  white-space: nowrap;            /* empêche le retour à la ligne */
  width: max-content;             /* s’étire à la taille du contenu => scroll si nécessaire */
  padding: 0 8px;                 /* petite gouttière pour le scroll */
}

/* Input de recherche : largeur “confort” fixe => déclenche le scroll en manque de place */
.search-input {
  flex: 0 0 560px;                /* largeur fixe (ajuste : 520/560/600) */
  height: 41px;
  box-sizing: border-box;
  padding: 10px 20px;
  font-size: 16px;
  border: 2px solid #ccc;
  border-radius: 30px;
  background-color: #424242;
  outline: none;
  transition: border-color .3s, box-shadow .3s;
  margin: 0;                      /* ancien centrage auto supprimé */
}

/* Focus */
.search-input:focus {
  border-color: #4CAF50;
  box-shadow: 0 0 8px rgba(76, 175, 80, 0.4);
}
.search-input::placeholder {
  color: #aaa;
  font-style: italic;
}

/* Checkbox + label */
.selflinks {
  flex: 0 0 auto;                 /* ne rétrécit pas */
  display: inline-flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  cursor: pointer;
}


/* titre + ligne organisme centrés (si utilisés) */
.graph-header { text-align: center; margin-bottom: 6px; }
.graph-header h3 { margin: 0; }
.organism-line { color: #ccc; font-size: .95rem; margin-top: 4px; }


.organism-line {
  color: #ccc;
  font-size: 0.95rem;
  margin-top: 4px;
}

/* Compteur */
.total-crosslinks {
  margin: 10px auto 0 auto; /* haut | horizontal | bas */
  font-weight: bold;
  font-size: 1.1em;
  color: #333;
  display: block;
  text-align: center; /* facultatif si tu veux centrer aussi le texte */
}
.export-btn {
  bottom: 20px;   /* distance du bas */
  right: 20px;    /* distance de la droite */
  z-index: 10;    /* pour qu’il soit au-dessus du canvas Cytoscape */
  padding: 8px 12px;
  background-color: #0074D9;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.export-btn:hover {
  background-color: #005fa3;
}

</style>