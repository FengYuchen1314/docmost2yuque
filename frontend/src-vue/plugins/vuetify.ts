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
          background: '#f6f7fb', surface: '#ffffff', 'surface-variant': '#eef1f6',
          primary: '#2563eb', secondary: '#475569', success: '#16a34a',
          warning: '#d97706', error: '#dc2626', info: '#0891b2',
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
    VBtn: { rounded: 'lg', elevation: 0 },
    VCard: { rounded: 'xl', elevation: 0 },
    VTextField: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VDialog: { maxWidth: 640 },
  },
})
