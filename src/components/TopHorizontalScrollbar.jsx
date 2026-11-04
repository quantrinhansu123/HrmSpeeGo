import { useEffect, useRef, useState } from 'react'

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])

function TopHorizontalScrollbar({ containerRef, position = 'top' }) {
  const trackRef = useRef(null)
  const spacerRef = useRef(null)
  const [hasScrollableContent, setHasScrollableContent] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const track = trackRef.current
    const spacer = spacerRef.current
    if (!container || !track || !spacer) return undefined

    let activeTarget = null
    let candidates = []
    let syncing = false
    let refreshFrame = 0
    const targetListeners = new Map()

    const syncTrackMetrics = (target) => {
      if (!target || !target.isConnected) return
      const trackWidth = track.clientWidth || container.clientWidth
      const targetOverflow = Math.max(0, target.scrollWidth - target.clientWidth)
      spacer.style.width = `${trackWidth + targetOverflow}px`
      syncing = true
      track.scrollLeft = target.scrollLeft
      requestAnimationFrame(() => { syncing = false })
    }

    const activateTarget = (target) => {
      activeTarget = target
      setHasScrollableContent(Boolean(target))
      requestAnimationFrame(() => syncTrackMetrics(target))
    }

    const handleTrackScroll = () => {
      if (!activeTarget || syncing) return
      syncing = true
      activeTarget.scrollLeft = track.scrollLeft
      requestAnimationFrame(() => { syncing = false })
    }

    const refreshTargets = () => {
      const nextCandidates = []
      const tables = container.querySelectorAll('table, .table-responsive, [class*="table-wrap"], [class*="-scroll"]')

      tables.forEach((table) => {
        if (table.closest('.top-horizontal-scrollbar')) return
        let element = table
        while (element && element !== container) {
          const overflowX = window.getComputedStyle(element).overflowX
          if (
            SCROLLABLE_OVERFLOW.has(overflowX)
            && element.scrollWidth > element.clientWidth + 1
          ) {
            if (!nextCandidates.includes(element)) nextCandidates.push(element)
            break
          }
          element = element.parentElement
        }
      })

      if (
        nextCandidates.length === 0
        && container.scrollWidth > container.clientWidth + 1
      ) {
        nextCandidates.push(container)
      }

      targetListeners.forEach((listeners, target) => {
        if (nextCandidates.includes(target)) return
        target.removeEventListener('scroll', listeners.onScroll)
        target.removeEventListener('pointerenter', listeners.onActivate)
        target.removeEventListener('focusin', listeners.onActivate)
        target.removeEventListener('pointerdown', listeners.onActivate)
        targetListeners.delete(target)
      })

      nextCandidates.forEach((target) => {
        if (targetListeners.has(target)) return
        const onScroll = () => activateTarget(target)
        const onActivate = () => activateTarget(target)
        target.addEventListener('scroll', onScroll, { passive: true })
        target.addEventListener('pointerenter', onActivate)
        target.addEventListener('focusin', onActivate)
        target.addEventListener('pointerdown', onActivate)
        targetListeners.set(target, { onScroll, onActivate })
      })

      candidates = nextCandidates
      if (!activeTarget || !candidates.includes(activeTarget)) {
        activateTarget(candidates[0] || null)
      } else {
        setHasScrollableContent(true)
        syncTrackMetrics(activeTarget)
      }

      resizeObserver.disconnect()
      resizeObserver.observe(container)
      candidates.forEach((target) => {
        resizeObserver.observe(target)
        const table = target.querySelector('table')
        if (table) resizeObserver.observe(table)
      })
    }

    const scheduleRefresh = () => {
      if (refreshFrame) cancelAnimationFrame(refreshFrame)
      refreshFrame = requestAnimationFrame(refreshTargets)
    }

    const resizeObserver = new ResizeObserver(() => {
      if (activeTarget) syncTrackMetrics(activeTarget)
      else scheduleRefresh()
    })
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !record.target.closest?.('.top-horizontal-scrollbar'))) scheduleRefresh()
    })

    track.addEventListener('scroll', handleTrackScroll, { passive: true })
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    })
    window.addEventListener('resize', scheduleRefresh)
    refreshTargets()

    return () => {
      track.removeEventListener('scroll', handleTrackScroll)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleRefresh)
      if (refreshFrame) cancelAnimationFrame(refreshFrame)
      targetListeners.forEach((listeners, target) => {
        target.removeEventListener('scroll', listeners.onScroll)
        target.removeEventListener('pointerenter', listeners.onActivate)
        target.removeEventListener('focusin', listeners.onActivate)
        target.removeEventListener('pointerdown', listeners.onActivate)
      })
    }
  }, [containerRef])

  return (
    <div
      ref={trackRef}
      className={`top-horizontal-scrollbar top-horizontal-scrollbar--${position}`}
      data-visible={hasScrollableContent}
      role="region"
      aria-label={`Thanh cuộn ngang bảng phía ${position === 'bottom' ? 'dưới' : 'trên'}`}
      tabIndex={hasScrollableContent ? 0 : -1}
    >
      <div ref={spacerRef} className="top-horizontal-scrollbar__spacer" />
    </div>
  )
}

export default TopHorizontalScrollbar
