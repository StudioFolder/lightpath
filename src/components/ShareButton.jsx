import { useState, useEffect } from 'react'
import { DateTime } from 'luxon'
import { captureFlightImage, preloadLogo } from '../utils/captureUtils'
import { generateShareCard } from '../utils/cardGenerator'
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
  isPlaying,
  isMobile,
  getLocalTimeAtAirport,
  getLocalDateAtAirport,
  getTimezoneAbbreviation,
  getAirportTimezone,
}) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

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
      // Capture the globe render (returns a canvas, not a blob)
      const [globeCanvas] = await Promise.all([
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

      // Calculate arrival time (departure + duration)
      const flightDurationMs = (flightResults.durationHours * 60 + flightResults.durationMins) * 60 * 1000
      const arrivalTime = new Date(departureTime.getTime() + flightDurationMs)

      // Format departure date/time in local timezone
      const depTZ = getAirportTimezone(departureAirport)
      const depDT = DateTime.fromJSDate(departureTime, { zone: depTZ })
      const depDateTimeStr = depDT.toFormat('dd.MM HH:mm')
      const depTZStr = getTimezoneAbbreviation(departureAirport)

      // Format arrival date/time in local timezone
      const arrTZ = getAirportTimezone(arrivalAirport)
      const arrDT = DateTime.fromJSDate(arrivalTime, { zone: arrTZ })
      const arrDateTimeStr = arrDT.toFormat('dd.MM HH:mm')
      const arrTZStr = getTimezoneAbbreviation(arrivalAirport)

      // Generate the branded share card
      const blob = await generateShareCard(globeCanvas, {
        departureCode,
        arrivalCode,
        departureCity: departureAirport.city,
        arrivalCity: arrivalAirport.city,
        departureCountry: departureAirport.country,
        arrivalCountry: arrivalAirport.country,
        distance: flightResults.distance,
        durationHours: flightResults.durationHours,
        durationMins: flightResults.durationMins,
        daylightHours: flightResults.daylightHours,
        daylightMins: flightResults.daylightMins,
        darknessHours: flightResults.darknessHours,
        darknessMins: flightResults.darknessMins,
        departureDateTime: depDateTimeStr,
        departureTZ: depTZStr,
        arrivalDateTime: arrDateTimeStr,
        arrivalTZ: arrTZStr,
      }, isBWMode)

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

  const handleCopyUrl = async () => {
    if (isCopied) return
    try {
      await navigator.clipboard.writeText(window.location.href)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = window.location.href
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    setIsCopied(true)
    const btn = document.querySelector('.copy-url-button')
    if (!btn) return

    // Phase 1: fade out copy icon (150ms)
    btn.classList.add('phase-1')

    setTimeout(() => {
      // Phase 2: draw the tick stroke (350ms)
      btn.classList.remove('phase-1')
      btn.classList.add('phase-2')

      setTimeout(() => {
        // Hold completed tick (600ms), then phase 3: fade out tick (200ms)
        setTimeout(() => {
          btn.classList.remove('phase-2')
          btn.classList.add('phase-3')

          setTimeout(() => {
            // Phase 4: fade copy icon back in (200ms)
            btn.classList.remove('phase-3')
            btn.classList.add('phase-4')

            setTimeout(() => {
              btn.classList.remove('phase-4')
              setIsCopied(false)
            }, 250)
          }, 200)
        }, 600)
      }, 350)
    }, 150)
  }

  return (
    <div
      className="share-actions"
      style={{ opacity: isPlaying ? 0 : 1, pointerEvents: isPlaying ? 'none' : 'all', transition: 'opacity 0.3s ease' }}
    >
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
      <button
        className={`copy-url-button${isCopied ? ' copied' : ''}`}
        onClick={handleCopyUrl}
        aria-label="Copy flight URL"
      >
        <span className="copy-url-icon-wrapper">
          <img
            src={isBWMode ? '/copy-icon-bw.svg' : '/copy-icon.svg'}
            alt="Copy URL"
            className="copy-url-icon copy-url-icon--copy"
          />
          <svg
            className="copy-url-icon copy-url-icon--tick"
            width="21"
            height="21"
            viewBox="0 0 21 21"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 11L8 17L19 4"
              stroke={isBWMode ? 'black' : 'white'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  )
}
