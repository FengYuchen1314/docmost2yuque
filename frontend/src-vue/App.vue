<script setup lang="ts">
import { useUiStore } from './stores/ui'

const ui = useUiStore()
</script>

<template>
  <v-app class="app-shell">
    <router-view />
    <v-snackbar v-model="ui.toast.open" :color="ui.toast.color" location="bottom right" :timeout="3600">
      {{ ui.toast.text }}
      <template #actions><v-btn variant="text" @click="ui.toast.open = false">关闭</v-btn></template>
    </v-snackbar>
  </v-app>
</template>
