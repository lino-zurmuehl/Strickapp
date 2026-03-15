import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const repositoryName = globalThis.process?.env?.GITHUB_REPOSITORY?.split('/')[1]
  const basePath = globalThis.process?.env?.VITE_BASE_PATH ||
    (mode === 'production' ? `/${repositoryName || 'Strickapp'}/` : '/')

  return {
    plugins: [react()],
    base: basePath,
  }
})
