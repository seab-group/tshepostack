import { useState, useEffect, useRef } from 'react'
import { useQueryClient, QueryClient } from '@tanstack/react-query'

export type FleetEvent =
  | { type: 'fleet-update'; agent: string; [key: string]: unknown }
  | { type: 'approval'; [key: string]: unknown }
  | { type: 'stuck'; agent: string; [key: string]: unknown }
  | { type: 'resolve'; id: string; [key: string]: unknown }

// Module-level singleton state — shared across all hook consumers
let _sse: EventSource | null = null
let _refCount = 0
let _backoffMs = 1000
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _queryClient: QueryClient | null = null
let _EventSourceClass: typeof EventSource | null = null

type Listener = (connected: boolean, event?: FleetEvent) => void
const _listeners = new Set<Listener>()

function _notify(connected: boolean, event?: FleetEvent) {
  for (const l of _listeners) l(connected, event)
}

function _connect() {
  if (!_queryClient || !_EventSourceClass) return

  _sse = new _EventSourceClass('/api/events')

  _sse.onopen = () => {
    _backoffMs = 1000
    _notify(true)
  }

  _sse.onerror = () => {
    _sse?.close()
    _sse = null
    _notify(false)

    if (_refCount === 0) return

    const delay = _backoffMs
    _backoffMs = Math.min(_backoffMs * 2, 30_000)

    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null
      if (_refCount > 0) _connect()
    }, delay)
  }

  _sse.addEventListener('fleet-update', (e) => {
    const payload = JSON.parse((e as MessageEvent).data) as { agent: string; [key: string]: unknown }
    _queryClient!.setQueryData(['fleet', payload.agent], payload)
    _notify(true, { type: 'fleet-update', ...payload })
  })

  _sse.addEventListener('approval', (e) => {
    const payload = JSON.parse((e as MessageEvent).data) as Record<string, unknown>
    _queryClient!.invalidateQueries({ queryKey: ['queue'] })
    _notify(true, { type: 'approval', ...payload })
  })

  _sse.addEventListener('stuck', (e) => {
    const payload = JSON.parse((e as MessageEvent).data) as { agent: string; [key: string]: unknown }
    _queryClient!.setQueryData(['stuck', payload.agent], payload)
    _notify(true, { type: 'stuck', ...payload })
  })

  _sse.addEventListener('resolve', (e) => {
    const payload = JSON.parse((e as MessageEvent).data) as { id: string; [key: string]: unknown }
    _queryClient!.invalidateQueries({ queryKey: ['queue'] })
    _notify(true, { type: 'resolve', ...payload })
  })
}

export function useFleetStream(EventSourceClass: typeof EventSource = window.EventSource) {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<FleetEvent | null>(null)
  // Backoff lives in a ref — changes don't trigger re-renders
  const backoffRef = useRef(_backoffMs)

  useEffect(() => {
    _refCount++
    if (!_queryClient) _queryClient = queryClient
    if (!_EventSourceClass) _EventSourceClass = EventSourceClass

    const listener: Listener = (c, ev) => {
      setConnected(c)
      if (ev != null) setLastEvent(ev)
      backoffRef.current = _backoffMs
    }
    _listeners.add(listener)

    if (!_sse) {
      _connect()
    } else {
      setConnected(true)
    }

    return () => {
      _listeners.delete(listener)
      _refCount--
      if (_refCount === 0) {
        if (_reconnectTimer != null) {
          clearTimeout(_reconnectTimer)
          _reconnectTimer = null
        }
        _sse?.close()
        _sse = null
        _backoffMs = 1000
        _queryClient = null
        _EventSourceClass = null
      }
    }
  }, [EventSourceClass, queryClient])

  return { connected, lastEvent }
}
