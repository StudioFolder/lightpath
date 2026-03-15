export async function shareImage(blob, filename) {
  const file = new File([blob], filename, {
    type: 'image/png',
    lastModified: Date.now(),
  })

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('Share failed:', err.name, err.message)
    }
  }

  // Fallback: download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
