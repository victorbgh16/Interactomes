<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-panel">
      <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
      <slot />
    </div>
  </div>
</template>

<script setup>
// Simple modal. Ferme si on clique sur l’overlay ou sur ×
</script>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; display: grid; place-items: center;
  background: rgba(0,0,0,0.5); z-index: 1000; padding: 16px;
}
.modal-panel {
  position: relative; width: 100%; max-width: 420px; background: #111; color: #eee;
  border: 1px solid #333; border-radius: 8px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.4);
}
.modal-close {
  position: absolute; top: 8px; right: 10px; border: none; background: transparent;
  font-size: 22px; color: #aaa; cursor: pointer;
}
.modal-close:hover { color: #fff; }
</style>
