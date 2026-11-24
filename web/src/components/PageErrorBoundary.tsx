import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Card } from '@/components/ui'

/** A page that fails to load or crashes shows this instead of a white screen. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    // A page file from an older version that no longer exists: load the new version once
    if (isChunkError(error)) reloadOnce()
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Card className="mx-auto mt-10 max-w-md text-center">
        <p className="font-bold">الصفحة دي مفتحتش</p>
        <p className="mt-1 text-sm text-muted">غالبًا الموقع اتحدّث. اعمل تحديث للصفحة.</p>
        <Button className="mt-4" onClick={() => location.reload()}>
          <RefreshCw className="size-4" /> تحديث
        </Button>
      </Card>
    )
  }
}

export function isChunkError(e: unknown) {
  const m = String((e as { message?: string })?.message ?? e)
  return /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading dynamically/i.test(m)
}

/** Reload at most once a minute, so a real outage can't loop. */
export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem('chunk-reload') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('chunk-reload', String(Date.now()))
  } catch {
    /* no storage: reload anyway */
  }
  location.reload()
}
