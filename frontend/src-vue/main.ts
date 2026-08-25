import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { vuetify } from './plugins/vuetify'
import './styles/app.css'

const app = createApp(App)
app.use(createPinia())
app.use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } } } })
app.use(router)
app.use(vuetify)
app.mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
