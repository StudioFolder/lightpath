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
  const [isCapturing, setIsCapturing] = useState(false)

  useEffect(() => {
    preloadLogo(true)
    preloadLogo(false)
  }, [])

  if (!isPanelCollapsed) return null

  const handleClick = async () => {
    if (isCapturing) return
    if (!rendererRef.current || !sceneRef.current || !flightResults) return

    setIsCapturing(true)

    try {
      // Run capture and a minimum 300ms delay in parallel
      // so the pulse animation always plays fully
      const [blob] = await Promise.all([
        captureFlightImage(
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
        ),
        new Promise(r => setTimeout(r, 300)),
      ])

      const dateStr = departureTime
        ? departureTime.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
      const filename = `lightpath-${departureCode}-${arrivalCode}-${dateStr}.png`

      await shareImage(blob, filename)
    } catch (err) {
      console.error('Capture/share failed:', err)
    } finally {
      setIsCapturing(false)
    }
  }

  return (
    <button
      className={`share-button ${isCapturing ? 'capturing' : ''}`}
      onClick={handleClick}
      disabled={isCapturing}
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
