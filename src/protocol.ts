import type { WebSocketMessage } from './protocol.generated'

export type ClientTextMessage = Extract<WebSocketMessage, { type: 'Text' }>
export type ServerMessage = Exclude<WebSocketMessage, ClientTextMessage>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

export function createClientTextMessage(text: string): ClientTextMessage {
  return { type: 'Text', text }
}

export function parseServerMessage(data: string): ServerMessage | null {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }

  if (!isRecord(value) || typeof value.type !== 'string') return null

  switch (value.type) {
    case 'transcript':
      if (
        hasOnlyKeys(value, ['type', 'role', 'text']) &&
        (value.role === 'user' || value.role === 'tamada') &&
        typeof value.text === 'string' &&
        value.text.length > 0
      ) {
        return { type: 'transcript', role: value.role, text: value.text }
      }
      return null
    case 'status':
      if (
        hasOnlyKeys(value, ['type', 'state']) &&
        (value.state === 'live' || value.state === 'reconnecting')
      ) {
        return { type: 'status', state: value.state }
      }
      return null
    case 'interrupted':
      return hasOnlyKeys(value, ['type']) ? { type: 'interrupted' } : null
    case 'turn_complete':
      return hasOnlyKeys(value, ['type']) ? { type: 'turn_complete' } : null
    case 'error':
      if (
        hasOnlyKeys(value, ['type', 'message']) &&
        typeof value.message === 'string' &&
        value.message.length > 0
      ) {
        return { type: 'error', message: value.message }
      }
      return null
    default:
      return null
  }
}
