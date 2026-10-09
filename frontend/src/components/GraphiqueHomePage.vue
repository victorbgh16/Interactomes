<template>
  <nav class="organism-navbar">
    <button
        v-for="org in organisms"
        :key="org.name"
        @click="loadOrganismGraph(org)"
        :class="{ active: selectedOrganism?.name === org.name }"
    >
      {{ org.short }}
    </button>
  </nav>

  <div class="graph-container" ref="graphContainer"></div>
    <button class="toggle-labels-btn" @click="showLabels = !showLabels">
      {{ showLabels ? 'Hide names' : 'Show names' }}
    </button>


</template>
<script setup>
import * as d3 from 'd3'
import { onMounted, ref, watch } from 'vue'

const graphContainer = ref(null)
const showLabels = ref(false)
const selectedOrganism = ref(null)
const organisms = [
  { name: 'Cyanophora paradoxa', taxon: 2762, short: 'Cyanophora' },
  { name: 'Chlamydomonas reinhardtii', taxon: 3055, short: 'Chlamy' },
  { name: 'Sus scrofa', taxon: 9823, short: 'Pig' },
  { name: 'Bos taurus', taxon: 9913, short: 'Cow' },
  { name: 'Brassica oleracea var. oleracea', taxon: 109376, short: 'Cauliflower' },
  { name: 'Tetrahymena thermophila (strain SB210)', taxon: 312017, short: 'Tetrahymena' }
]

const clusterColors = d3.schemeCategory10  // jusqu'à 10 clusters — peut être étendu plus tard
const nodeMap = new Map()
onMounted(async () => {
  await loadOrganismGraph(organisms[0])
})
async function loadOrganismGraph(org) {
  selectedOrganism.value = org
  nodeMap.clear()
  d3.select(graphContainer.value).selectAll('*').remove()

  let counter = 0

  // ⬇️ 1. Récupère le dataset Cyanophora de user 1
  //const response = await fetch('http://localhost:3001/datasets?user_id=1') pour local uniquement
  const response = await fetch('/datasets?user_id=1')
  const { items: datasets } = await response.json()

  const targetDataset = datasets.find(d => d.organism_taxon_id === org.taxon)

  if (!targetDataset) {
    console.warn('Dataset not found')
    return
  }

  // ⬇️ 2. Récupère tous les crosslinks pour ce dataset
  //const res = await fetch(`http://localhost:3001/datasets/${targetDataset.id}/crosslinks?limit=40000`)
  const res = await fetch(`/datasets/${targetDataset.id}/crosslinks?limit=40000`)

  const {items} = await res.json()
  console.log(items);


  const nodes = []
  const links = []
  // ⬇️ 3. Crée les nœuds uniques et les liens
  items.forEach(row => {
    const p1 = row.protein1_uid
    const p2 = row.protein2_uid

    if (!nodeMap.has(p1)) {
      nodeMap.set(p1, {
        id: p1,
        label: p1,
        cluster: 0,
        organism: org.name,
        index: counter++
      })
      nodes.push(nodeMap.get(p1))
    }

    if (!nodeMap.has(p2)) {
      nodeMap.set(p2, {
        id: p2,
        label: p2,
        cluster: 0,
        organism: org.name,
        index: counter++
      })
      nodes.push(nodeMap.get(p2))
    }

    links.push({
      source: nodeMap.get(p1),
      target: nodeMap.get(p2),
      score: row.score
    })
  })
  console.log('Nodes:', nodes)
  console.log('Links:', links)
  // ⬇️ 4. Assigne des clusters locaux par composant connexe
  assignLocalClusters(nodes, links)

  // ⬇️ 5. Dessine le graphe
  drawGraph(nodes, links)
}

// 🔷 Détection de clusters (composants connexes)
function assignLocalClusters(nodes, links) {
  const adjacency = new Map()
  nodes.forEach(n => adjacency.set(n.id, []))
  links.forEach(link => {
    adjacency.get(link.source.id).push(link.target.id)
    adjacency.get(link.target.id).push(link.source.id)
  })

  let clusterId = 0
  const visited = new Set()

  function bfs(startId) {
    const queue = [startId]
    visited.add(startId)

    while (queue.length > 0) {
      const current = queue.shift()
      const node = nodes.find(n => n.id === current)
      if (node) node.cluster = clusterId

      for (const neighbor of adjacency.get(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
  }

  nodes.forEach(n => {
    if (!visited.has(n.id)) {
      bfs(n.id)
      clusterId++
    }
  })
}

// 🔷 Affichage du graphe
function drawGraph(nodes, links) {
  const width = graphContainer.value.clientWidth
  const height = graphContainer.value.clientHeight

  const svg = d3.select(graphContainer.value)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('background-color', '#000')

  const zoomGroup = svg.append('g')

  svg.call(
      d3.zoom()
          .scaleExtent([0.1, 5])
          .on('zoom', ({ transform }) => zoomGroup.attr('transform', transform))
  )

  const link = zoomGroup.append('g')
      .attr('stroke', '#aaa')
      .attr('stroke-opacity', 0.5)
      .selectAll('line')
      .data(links)
      .join('line')

  const nodeGroup = zoomGroup.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', 3)
      .attr('fill', d => clusterColors[d.cluster % clusterColors.length])
      .call(
          d3.drag()
              .on('start', (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart()
                d.fx = d.x
                d.fy = d.y
              })
              .on('drag', (event, d) => {
                d.fx = event.x
                d.fy = event.y
              })
              .on('end', (event, d) => {
                if (!event.active) simulation.alphaTarget(0)
                d.fx = null
                d.fy = null
              })
      )

  const labels = zoomGroup.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.label)
      .attr('fill', '#4cf')
      .attr('font-size', 10)
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .style('opacity', showLabels.value ? 1 : 0)

  watch(showLabels, value => {
    labels.transition().duration(300).style('opacity', value ? 1 : 0)
  })

  const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).distance(20).strength(0.3))  // <--- plus faible
      .force('charge', d3.forceManyBody().strength(-20))              // <--- plus faible répulsion
      .force('collide', d3.forceCollide(8))
      .force('x', d3.forceX(width / 2).strength(0.03))                // centrage doux
      .force('y', d3.forceY(height / 2).strength(0.03))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .alpha(1)
      .restart()
      .on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y)

        nodeGroup
            .attr('cx', d => d.x)
            .attr('cy', d => d.y)

        labels
            .attr('x', d => d.x)
            .attr('y', d => d.y - 8)
      })
}
</script>

<style scoped>
.graph-container {
  position: absolute;
  top: 106px; /* 64px (header) + 42px (navbar incl. padding/margin) */
  left: 0;
  width: 100vw;
  height: calc(100vh - 106px); /* prend tout l'espace restant */
  overflow: hidden;
}

.organism-navbar {
  position: fixed;
  top: 64px; /* collé juste sous le header */
  left: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  gap: 10px;
  background-color: #000;
  padding: 10px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.4);
  z-index: 10;
  box-sizing: border-box;
}

.organism-navbar button {
  background: #222;
  color: #4cf;
  border: 1px solid #555;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.organism-navbar button.active {
  background-color: #444;
  color: #fff;
}
.toggle-labels-btn {
  position: fixed;
  top: 180px;
  right: 12px;
  background-color: #222;
  color: #4cf;
  border: 1px solid #555;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  z-index: 20;
}

.toggle-labels-btn:hover {
  background-color: #333;
}

</style>
