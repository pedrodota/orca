import { z } from 'zod'

export const tabContentTypeSchema = z.enum([
  'terminal',
  'editor',
  'diff',
  'conflict-review',
  'check-details',
  'agent-session',
  'browser',
  'simulator',
  'desktop-app'
])

export const workspaceVisibleTabTypeSchema = z.enum([
  'terminal',
  'editor',
  'agent-session',
  'browser',
  'simulator',
  'desktop-app'
])
