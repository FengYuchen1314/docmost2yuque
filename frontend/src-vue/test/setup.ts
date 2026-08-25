import { config } from '@vue/test-utils'

config.global.stubs = { transition: false, 'transition-group': false }
Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
