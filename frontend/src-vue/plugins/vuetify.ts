import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'knowledgeLight',
    themes: {
      knowledgeLight: {
        dark: false,
        colors: {
          background: '#ffffff', surface: '#ffffff', 'surface-variant': '#f4f5f5',
          primary: '#2f6feb', secondary: '#646a67', success: '#00b96b',
          warning: '#d97904', error: '#d33b35', info: '#1685a9',
        },
      },
      knowledgeDark: {
        dark: true,
        colors: {
          background: '#0b1020', surface: '#111827', 'surface-variant': '#1f2937',
          primary: '#60a5fa', secondary: '#94a3b8', success: '#4ade80',
          warning: '#fbbf24', error: '#f87171', info: '#22d3ee',
        },
      },
    },
  },
  defaults: {
    VBtn: { rounded: 'sm', elevation: 0 },
    VCard: { rounded: 'md', elevation: 0 },
    VTextField: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VDialog: { maxWidth: 640 },
  },
})
