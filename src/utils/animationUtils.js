/**
 * Animate a value from start to target over 300ms with ease-out.
 * Calls onUpdate each frame with the current value, and onComplete when done.
 * 
 * @param {number} from - Starting value
 * @param {number} to - Target value
 * @param {function} onUpdate - Called each frame with current value
 * @param {function} [onComplete] - Called when animation finishes
 * @returns {object} Controller with cancel() method
 */
export function animateValue(from, to, onUpdate, onComplete) {
  const duration = 400
  const startTime = performance.now()
  let cancelled = false

  const animate = (now) => {
    if (cancelled) return

    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    const easeT = t * (2 - t) // Ease out

    const value = from + (to - from) * easeT
    onUpdate(value)

    if (t < 1) {
      requestAnimationFrame(animate)
    } else {
      if (onComplete) onComplete()
    }
  }

  requestAnimationFrame(animate)

  return {
    cancel: () => { cancelled = true }
  }
}