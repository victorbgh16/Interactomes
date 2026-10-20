<template>
  <div v-if="crosslinks?.length" class="crosslink-table">
    <div class="table-header">
      <h3 class="mb-2 text-lg font-semibold text-gray-700">
        Crosslinks for {{ proteinLabel }}
      </h3>
      <button class="export-csv-btn" @click="exportCsv">Export CSV</button>
    </div>

    <DataTable :value="crosslinks" scrollable scrollHeight="600px" class="p-datatable-sm">
      <Column field="Protein1" header="Protein1" />
      <Column field="Protein2" header="Protein2" />
      <Column field="AbsPos1" header="AbsPos1" />
      <Column field="AbsPos2" header="AbsPos2" />
      <Column field="Score"   header="Score" />
    </DataTable>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'

const props = defineProps({
  selectedProtein: {
    type: Object,
    required: false,
    default: null
  },
  crosslinks: {
    type: Array,
    required: true
  }
})

// Affiche le nom ou l'ID si pas de nom
const proteinLabel = computed(() =>
    props.selectedProtein?.gene_name ||
    props.selectedProtein?.uniprot_id ||
    'Selected protein'
)

function exportCsv () {
  const cols = ['Protein1', 'Protein2', 'AbsPos1', 'AbsPos2', 'Score']

  const esc = v => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    // Quote si virgule, guillemet ou saut de ligne
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const header = cols.join(',')
  const rows = (props.crosslinks || []).map(r => cols.map(c => esc(r[c])).join(','))
  const csv = [header, ...rows].join('\n')

  // BOM pour Excel + téléchargement
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const safeName = (proteinLabel.value || 'protein').replace(/[^\w\-]+/g, '_')
  const a = document.createElement('a')
  a.href = url
  a.download = `crosslinks_${safeName}.csv`
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  a.remove()
}
</script>

<style scoped>
.crosslink-table {
  width: 100%;
  background-color: #141414;
  color: #fff;
}


.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: .5rem;
  background-color: #141414;
  color: #dcdcdc;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.export-csv-btn {
  padding: 6px 10px;
  background-color: #0ea5e9; /* bleu clair */
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.export-csv-btn:hover {
  background-color: #0284c7;
}

.crosslink-table ::v-deep(.p-datatable-thead > tr > th) {
  background-color: #141414 !important;
  color: white;
  font-style: italic;
  position: sticky;
  top: 0;
  z-index: 1;
}

.crosslink-table ::v-deep(.p-datatable-thead > tr > th),
.crosslink-table ::v-deep(.p-datatable-tbody > tr > td) {
  border-right: 1px solid #888;
}
.crosslink-table ::v-deep(.p-datatable-thead > tr > th:first-child),
.crosslink-table ::v-deep(.p-datatable-tbody > tr > td:first-child) {
  border-left: 1px solid #888;
}
.crosslink-table ::v-deep(.p-datatable-thead > tr>th) {
  border-top: 1px solid #888;
}

</style>
