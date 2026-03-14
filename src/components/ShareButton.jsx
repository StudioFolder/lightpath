import { useState, useEffect } from 'react'
import { captureFlightImage, preloadLogo } from '../utils/captureUtils'
import { shareImage } from '../utils/shareUtils'

export default function ShareButton({
  rendererRef,
  sceneRef,
  progressTubeRef,
  transitionLabelsRef,
  flightLineRef,
  departureAirport,
  arrivalAirport,
  departureCode,
  arrivalCode,
  departureTime,
  flightResults,
  isPanelCollapsed,
  isBWMode,
}) {
  const [readyBlob, setReadyBlob] = useState(null)
  const [readyFilename, setReadyFilename] = useState(null)

  useEffect(() => {
    preloadLogo(true)
    preloadLogo(false)
  }, [])

  useEffect(() => {
    if (!isPanelCollapsed) {
      setReadyBlob(null)
      setReadyFilename(null)
      return
    }
    if (!rendererRef.current || !sceneRef.current || !flightResults) return

    let cancelled = false

    async function preCapture() {
      try {
        const blob = await captureFlightImage(
          rendererRef.current,
          sceneRef.current,
          progressTubeRef.current,
          transitionLabelsRef.current,
          flightLineRef.current?.userData?.routeCurve,
          {
            departure: departureAirport,
            arrival: arrivalAirport,
            distance: flightResults.distance,
          },
          isBWMode
        )
        if (!cancelled) {
          const dateStr = departureTime
            ? departureTime.toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0]
          setReadyBlob(blob)
          setReadyFilename(`lightpath-${departureCode}-${arrivalCode}-${dateStr}.png`)
        }
      } catch (err) {
        console.error('Pre-capture failed:', err)
      }
    }

    preCapture()

    return () => { cancelled = true }
  }, [isPanelCollapsed, isBWMode, flightResults, departureAirport, arrivalAirport, departureCode, arrivalCode, departureTime])

  if (!isPanelCollapsed) return null

  const handleClick = async () => {
    if (!readyBlob) return

    console.log('[ShareButton] readyBlob size:', readyBlob.size, 'type:', readyBlob.type)
    console.log('[ShareButton] navigator.share exists:', !!navigator.share)
    console.log('[ShareButton] navigator.canShare exists:', !!navigator.canShare)

    const testFile = new File([readyBlob], readyFilename, { type: 'image/png', lastModified: Date.now() })
    console.log('[ShareButton] canShare files:', navigator.canShare ? navigator.canShare({ files: [testFile] }) : 'N/A')

    try {
      await shareImage(readyBlob, readyFilename)
      console.log('[ShareButton] shareImage completed')
    } catch (err) {
      console.error('[ShareButton] Share failed:', err.name, err.message)
    }
  }

  return (
    <button
      className="share-button"
      onClick={handleClick}
      disabled={!readyBlob}
      aria-label="Share flight image"
    >
      <img
        src={isBWMode ? '/capture-icon-bw.svg' : '/capture-icon.svg'}
        alt="Share"
        className="share-icon"
      />
    </button>
  )
}
