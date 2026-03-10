import { useState } from 'react'
import { DateTime } from 'luxon'
import AirportSearchInput from './AirportSearchInput'

export default function FlightInputPanel({
  // State
  departureCode,
  arrivalCode,
  departureAirport,
  arrivalAirport,
  departureTime,
  airports,
  isPanelCollapsed,
  isPanelFading,
  isBWMode,
  isMobile,
  isPlaying,
  showMobileMenu,
  // Callbacks
  setDepartureCode,
  setDepartureAirport,
  setArrivalCode,
  setArrivalAirport,
  setSearchEditing,
  setDepartureTime,
  setIsPanelCollapsed,
  setIsPanelFading,
  setShowFlightStats,
  setIsHamburgerOpen,
  setIsMobileMenuClosing,
  setExpandedSection,
  setShowMobileMenu,
  setIsMobileMenuAnimating,
  // Functions
  searchAirports,
  calculateFlight,
  getAirportTimezone,
}) {

  const [hasEnteredRouteMode, setHasEnteredRouteMode] = useState(false)

  if (departureAirport && arrivalAirport && !hasEnteredRouteMode) {
    setHasEnteredRouteMode(true)
  }

  return (
    <div className="flight-input-wrapper">
      <div 
        className={`flight-input ${isPanelCollapsed ? 'collapsed' : ''} ${isPanelFading ? 'fading' : ''}`}
        onClick={isPanelCollapsed ? () => {
          if (!isMobile) {
            setIsPanelCollapsed(false)
            setShowFlightStats(false)
            return
          }
          if (showMobileMenu) {
            setIsHamburgerOpen(false)
            setIsMobileMenuClosing(true)
            setExpandedSection(null)
            setTimeout(() => {
              setShowMobileMenu(false)
              setTimeout(() => {
                setIsMobileMenuClosing(false)
                setIsMobileMenuAnimating(false)
              }, 300)
            }, 50)
          }
          setIsPanelFading(true)
          setTimeout(() => {
            setIsPanelCollapsed(false)
            setShowFlightStats(false)
            setIsPanelFading(false)
          }, 200)
        } : undefined}
        style={isPanelCollapsed ? { cursor: 'pointer', ...(isMobile ? { opacity: isPlaying ? 0 : 1, pointerEvents: isPlaying ? 'none' : 'all', transition: 'opacity 0.3s ease' } : {}) } : (isMobile ? { opacity: isPlaying ? 0 : 1, pointerEvents: isPlaying ? 'none' : 'all', transition: 'opacity 0.3s ease' } : {})}
      >
        <div className="panel-header">
          <h3>Search Route</h3>
          <button 
            className={`collapse-button ${isPanelCollapsed ? 'collapsed' : ''}`}
            onClick={(e) => {
              if (isPanelCollapsed) return
              e.stopPropagation()
              if (!isMobile) {
                setIsPanelCollapsed(true)
                return
              }
              setIsPanelFading(true)
              setTimeout(() => {
                setIsPanelCollapsed(true)
                setIsPanelFading(false)
              }, 200)
            }}
            aria-label={isPanelCollapsed ? "Expand panel" : "Collapse panel"}
          >
            <span className="collapse-arrow">▼</span>
            <svg className="collapse-lens" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
          </button>
        </div>

        <p 
          className={`panel-subtitle ${hasEnteredRouteMode ? 'hidden' : ''}`}
          onMouseMove={!isMobile ? (e) => {
            const spans = e.currentTarget.querySelectorAll('.tagline-word')
            spans.forEach(span => {
              const rect = span.getBoundingClientRect()
              span.style.setProperty('--torch-x', `${e.clientX - rect.left}px`)
              span.style.setProperty('--torch-y', `${e.clientY - rect.top}px`)
            })
          } : undefined}
          onMouseLeave={!isMobile ? (e) => {
            const spans = e.currentTarget.querySelectorAll('.tagline-word')
            spans.forEach(span => {
              span.style.setProperty('--torch-x', `-200px`)
              span.style.setProperty('--torch-y', `-200px`)
            })
          } : undefined}
        >
          {isMobile 
            ? <>Find a route between any airport and explore how your flight moves through <span className="subtitle-daylight">daylight</span>, <span className="subtitle-twilight">twilight</span>, and <span className="subtitle-darkness">darkness</span>.</>
            : <>Explore how your flight moves through <span className="tagline-word tagline-daylight">daylight</span>, <span className="tagline-word tagline-twilight">twilight</span>, and <span className="tagline-word tagline-darkness">darkness</span>.</>
          }
        </p>

        <div className="panel-content">
          {!hasEnteredRouteMode ? (
            <div className="airport-columns">
              <div className="airport-column">
                <span className="column-label">FROM</span>
                <AirportSearchInput
                  label="From"
                  code={departureCode}
                  airport={departureAirport}
                  searchAirports={searchAirports}
                  onSelect={(selected) => {
                    setDepartureCode(selected.code)
                    setDepartureAirport(selected)
                  }}
                  onSearchChange={() => {
                    setDepartureCode('')
                    setDepartureAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                  onClear={() => {
                    setDepartureCode('')
                    setDepartureAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                />
              </div>

              <div className="swap-airports-column">
                <button
                  className="swap-airports-btn"
                  onClick={() => {
                    const tempCode = departureCode
                    const tempAirport = departureAirport
                    setDepartureCode(arrivalCode)
                    setDepartureAirport(arrivalAirport)
                    setArrivalCode(tempCode)
                    setArrivalAirport(tempAirport)
                    setSearchEditing(prev => prev + 1)
                  }}
                  aria-label="Swap departure and arrival airports"
                  title="Swap airports"
                >
                  <img 
                    src={isBWMode ? "/swap-icon-bw.svg" : "/swap-icon.svg"} 
                    alt="Swap" 
                    className="swap-icon"
                  />
                </button>
              </div>

              <div className="airport-column">
                <span className="column-label">TO</span>
                <AirportSearchInput
                  label="To"
                  code={arrivalCode}
                  airport={arrivalAirport}
                  searchAirports={searchAirports}
                  onSelect={(selected) => {
                    setArrivalCode(selected.code)
                    setArrivalAirport(selected)
                  }}
                  onSearchChange={() => {
                    setArrivalCode('')
                    setArrivalAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                  onClear={() => {
                    setArrivalCode('')
                    setArrivalAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="airport-columns route-mode">
              <div className="airport-column">
                <span className="column-label">FROM</span>
                <AirportSearchInput
                  label="From"
                  code={departureCode}
                  airport={departureAirport}
                  searchAirports={searchAirports}
                  onSelect={(selected) => {
                    setDepartureCode(selected.code)
                    setDepartureAirport(selected)
                  }}
                  onSearchChange={() => {
                    setDepartureCode('')
                    setDepartureAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                  onClear={() => {
                    setDepartureCode('')
                    setDepartureAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                />
                {departureAirport && (
                  <div className="airport-details">
                    <span className="airport-city">{departureAirport.city}</span>
                    <span className="airport-country">{departureAirport.country}</span>
                  </div>
                )}
              </div>

              <div className="swap-airports-column">
                <button
                  className="swap-airports-btn"
                  onClick={() => {
                    const tempCode = departureCode
                    const tempAirport = departureAirport
                    setDepartureCode(arrivalCode)
                    setDepartureAirport(arrivalAirport)
                    setArrivalCode(tempCode)
                    setArrivalAirport(tempAirport)
                    setSearchEditing(prev => prev + 1)
                  }}
                  aria-label="Swap departure and arrival airports"
                  title="Swap airports"
                >
                  <img 
                    src={isBWMode ? "/swap-icon-bw.svg" : "/swap-icon.svg"} 
                    alt="Swap" 
                    className="swap-icon"
                  />
                </button>
              </div>

              <div className="airport-column">
                <span className="column-label">TO</span>
                <AirportSearchInput
                  label="To"
                  code={arrivalCode}
                  airport={arrivalAirport}
                  searchAirports={searchAirports}
                  onSelect={(selected) => {
                    setArrivalCode(selected.code)
                    setArrivalAirport(selected)
                  }}
                  onSearchChange={() => {
                    setArrivalCode('')
                    setArrivalAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                  onClear={() => {
                    setArrivalCode('')
                    setArrivalAirport(null)
                    setSearchEditing(prev => prev + 1)
                  }}
                />
                {arrivalAirport && (
                  <div className="airport-details">
                    <span className="airport-city">{arrivalAirport.city}</span>
                    <span className="airport-country">{arrivalAirport.country}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {departureAirport && !isPanelCollapsed && (
        <div className="flight-action-row">
          <div className="datetime-pill">
            <div className="datetime-display">
              <div className="datetime-field">
                <img src={isBWMode ? "/date-icon-bw.svg" : "/date-icon.svg"} alt="Date" className="datetime-icon" />
                <span className="datetime-value">
                  {departureAirport && departureTime
                    ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('MMMM d, yyyy')
                    : ''}
                </span>
                <input 
                  type="date"
                  className="datetime-hidden-input"
                  value={departureAirport && departureTime 
                    ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('yyyy-MM-dd')
                    : ''}
                  onChange={(e) => {
                    if (!departureAirport || !departureTime) return
                    const timezone = getAirportTimezone(departureAirport)
                    const currentTime = DateTime.fromJSDate(departureTime, { zone: timezone })
                    const [year, month, day] = e.target.value.split('-').map(Number)
                    const updated = currentTime.set({ year, month, day })
                    setDepartureTime(updated.toJSDate())
                  }}
                  disabled={!departureAirport}
                />
              </div>
              <div className="datetime-field">
                <img src={isBWMode ? "/time-icon-bw.svg" : "/time-icon.svg"} alt="Time" className="datetime-icon" />
                <input 
                  type="time"
                  className="datetime-native-input"
                  value={departureAirport && departureTime
                    ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('HH:mm')
                    : ''}
                  onChange={(e) => {
                    if (!departureAirport || !departureTime) return
                    const timezone = getAirportTimezone(departureAirport)
                    const currentDateTime = DateTime.fromJSDate(departureTime, { zone: timezone })
                    const [hour, minute] = e.target.value.split(':').map(Number)
                    const updated = currentDateTime.set({ hour, minute })
                    setDepartureTime(updated.toJSDate())
                  }}
                  disabled={!departureAirport}
                />
              </div>
            </div>
          </div>

          {arrivalAirport && (
            <button 
              className="calculate-pill"
              onClick={calculateFlight}
              disabled={
                !airports || 
                departureCode.length !== 3 || 
                arrivalCode.length !== 3 || 
                departureCode === arrivalCode
              }
            >
              CALCULATE
            </button>
          )}
        </div>
     )}
    </div>
  )
}