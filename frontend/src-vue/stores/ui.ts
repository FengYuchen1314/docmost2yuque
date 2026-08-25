import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const navigationOpen = ref(true)
  const searchOpen = ref(false)
  const createOpen = ref(false)
  const toast = ref({ open: false, text: '', color: 'success' })
  const notify = (text: string, color = 'success') => { toast.value = { open: true, text, color } }
  return { navigationOpen, searchOpen, createOpen, toast, notify }
})
