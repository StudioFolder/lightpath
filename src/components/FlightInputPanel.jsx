import { useState, useRef } from 'react'
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
  airportsIcao,
  isPanelCollapsed,
  isPanelFading,
  isBWMode,
  isMobile,
  isPlaying,
  showMobileMenu,
  searchMode,
  setSearchMode,
  callsignInput,
  setCallsignInput,
  callsignSearchResult,
  setCallsignSearchResult,
  callsignError,
  setCallsignError,
  isCallsignSearching,
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
  handleCallsignSearch,
  handleCallsignStart,
  getAirportTimezone,
}) {

  const [hasEnteredRouteMode, setHasEnteredRouteMode] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const dateInputRef = useRef(null)

  if (searchMode === 'route' && departureAirport && arrivalAirport && !hasEnteredRouteMode && !isTransitioning) {
    setIsTransitioning(true)
    setTimeout(() => {
      setHasEnteredRouteMode(true)
    }, 400)
  }

  function switchToRoute() {
    setSearchMode('route')
    setCallsignInput('')
    setCallsignSearchResult(null)
    setCallsignError(null)
    setHasEnteredRouteMode(false)
    setIsTransitioning(false)
  }

  function switchToCallsign() {
    setSearchMode('callsign')
    setCallsignInput('')
    setCallsignSearchResult(null)
    setCallsignError(null)
    setHasEnteredRouteMode(false)
    setIsTransitioning(false)
  }

  const isSubtitleHidden = hasEnteredRouteMode || isTransitioning || searchMode === 'callsign'

  // Resolve airports from ICAO codes when a callsign result is available
  const resolvedOrig = callsignSearchResult && airportsIcao
    ? airportsIcao[callsignSearchResult.summary.orig_icao] ?? null
    : null
  const resolvedDest = callsignSearchResult && airportsIcao
    ? airportsIcao[callsignSearchResult.summary.dest_icao_actual ?? callsignSearchResult.summary.dest_icao] ?? null
    : null

  // Determine whether to show the action row
  const showRouteActionRow   = searchMode === 'route'    && departureAirport && !isPanelCollapsed
  const showCallsignActionRow = searchMode === 'callsign' && callsignSearchResult && !isPanelCollapsed

  return (
    <div className={`flight-input-wrapper ${isPanelCollapsed ? 'collapsed' : ''}`}>
      <div
        className={`flight-input ${isPanelCollapsed ? 'collapsed' : ''} ${isPanelFading ? 'fading' : ''} ${hasEnteredRouteMode ? 'route-mode' : ''}`}
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
          <h3>
            Search{' '}
            <span
              style={{ cursor: 'pointer', opacity: searchMode === 'route' ? 1 : 0.4, transition: 'opacity 0.2s' }}
              onClick={(e) => { e.stopPropagation(); switchToRoute() }}
              onMouseEnter={(e) => { if (searchMode !== 'route') e.target.style.opacity = 0.7 }}
              onMouseLeave={(e) => { e.target.style.opacity = searchMode === 'route' ? 1 : 0.4 }}
            >Route</span>
            {' '}or{' '}
            <span
              style={{ cursor: 'pointer', opacity: searchMode === 'callsign' ? 1 : 0.4, transition: 'opacity 0.2s' }}
              onClick={(e) => { e.stopPropagation(); switchToCallsign() }}
              onMouseEnter={(e) => { if (searchMode !== 'callsign') e.target.style.opacity = 0.7 }}
              onMouseLeave={(e) => { e.target.style.opacity = searchMode === 'callsign' ? 1 : 0.4 }}
            >Flight</span>
          </h3>
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
            <svg className="collapse-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <img
              className="collapse-lens"
              src={isBWMode ? '/search-icon-bw.svg' : '/search-icon.svg'}
              alt="Search"
              width="20"
              height="20"
            />
          </button>
        </div>

        <p
          className={`panel-subtitle ${isSubtitleHidden ? 'hidden' : ''}`}
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
            ? <>Trace your flight through<br /> <span className="subtitle-daylight">daylight</span>, <span className="subtitle-twilight">twilight</span>, and <span className="subtitle-darkness">darkness</span></>
            : <>Trace your flight through<br /> <span className="tagline-word tagline-daylight">daylight</span>, <span className="tagline-word tagline-twilight">twilight</span>, and <span className="tagline-word tagline-darkness">darkness</span></>
          }
        </p>

        <div className="panel-content">
          {searchMode === 'route' ? (
            <div className={`airport-columns ${hasEnteredRouteMode ? 'route-mode' : ''} ${isTransitioning && !hasEnteredRouteMode ? 'fading-out' : ''}`}>
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
          ) : (
            /* callsign mode */
            callsignError ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.8 }}>{callsignError}</p>
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '1.1em', padding: '2px 8px' }}
                  onClick={() => setCallsignError(null)}
                  aria-label="Dismiss error"
                >×</button>
              </div>
            ) : callsignSearchResult ? (
              <div className="airport-columns route-mode">
                <div className="airport-column">
                  <span className="column-label">FROM</span>
                  <div className="input-group">
                    <span className="callsign-airport-code">
                      {resolvedOrig?.iata ?? callsignSearchResult.summary.orig_icao}
                    </span>
                  </div>
                  {resolvedOrig && (
                    <div className="airport-details">
                      <span className="airport-city">{resolvedOrig.city}</span>
                      <span className="airport-country">{resolvedOrig.country}</span>
                    </div>
                  )}
                </div>

                <div className="swap-airports-column" />

                <div className="airport-column">
                  <span className="column-label">TO</span>
                  <div className="input-group">
                    <span className="callsign-airport-code">
                      {resolvedDest?.iata ?? (callsignSearchResult.summary.dest_icao_actual ?? callsignSearchResult.summary.dest_icao)}
                    </span>
                  </div>
                  {resolvedDest && (
                    <div className="airport-details">
                      <span className="airport-city">{resolvedDest.city}</span>
                      <span className="airport-country">{resolvedDest.country}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="airport-columns" style={{ justifyContent: 'center' }}>
                  <div className="airport-column" style={{ alignItems: 'center' }}>
                    <span className="column-label">FLIGHT</span>
                    <div className="input-group">
                      <input
                        type="text"
                        value={callsignInput}
                        placeholder="e.g. KL1613"
                        disabled={isCallsignSearching}
                        style={{ textAlign: 'center' }}
                        onChange={(e) => setCallsignInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && callsignInput.trim()) {
                            handleCallsignSearch()
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                  <button
                    className="calculate-pill"
                    disabled={!callsignInput.trim() || isCallsignSearching}
                    onClick={handleCallsignSearch}
                  >
                    FIND
                  </button>
                </div>
              </>
            )
          )}
        </div>
      </div>

      {(showRouteActionRow || showCallsignActionRow) && (
        <div className="flight-action-row">
          <div className="datetime-pill">
            <div className="datetime-display">
              <div className="datetime-field" onClick={() => dateInputRef.current?.showPicker()}>
                <img src={isBWMode ? "/date-icon-bw.svg" : "/date-icon.svg"} alt="Date" className="datetime-icon" />
                <span className="datetime-value">
                  {showCallsignActionRow && departureTime
                    ? DateTime.fromJSDate(departureTime, { zone: 'utc' }).toFormat(isMobile ? 'MMM d' : 'MMM d, yyyy')
                    : (departureAirport && departureTime
                        ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat(isMobile ? 'MMM d' : 'MMM d, yyyy')
                        : '')
                  }
                </span>
                {(showRouteActionRow || showCallsignActionRow) && (
                  <input
                    ref={dateInputRef}
                    type="date"
                    className="datetime-hidden-input"
                    onClick={() => dateInputRef.current?.showPicker()}
                    value={departureTime
                      ? (showCallsignActionRow
                          ? DateTime.fromJSDate(departureTime, { zone: 'utc' }).toFormat('yyyy-MM-dd')
                          : (departureAirport
                              ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('yyyy-MM-dd')
                              : ''))
                      : ''}
                    onChange={(e) => {
                      if (!departureTime) return
                      if (showCallsignActionRow) {
                        const current = DateTime.fromJSDate(departureTime, { zone: 'utc' })
                        const [year, month, day] = e.target.value.split('-').map(Number)
                        const updated = current.set({ year, month, day })
                        setDepartureTime(updated.toJSDate())
                      } else {
                        if (!departureAirport) return
                        const timezone = getAirportTimezone(departureAirport)
                        const currentTime = DateTime.fromJSDate(departureTime, { zone: timezone })
                        const [year, month, day] = e.target.value.split('-').map(Number)
                        const updated = currentTime.set({ year, month, day })
                        setDepartureTime(updated.toJSDate())
                      }
                    }}
                    disabled={!departureAirport && !callsignSearchResult}
                  />
                )}
              </div>
              <div className="datetime-field">
                <img src={isBWMode ? "/time-icon-bw.svg" : "/time-icon.svg"} alt="Time" className="datetime-icon" />
                <input
                  type="time"
                  className="datetime-native-input"
                  value={departureTime
                    ? (showCallsignActionRow
                        ? DateTime.fromJSDate(departureTime, { zone: 'utc' }).toFormat('HH:mm')
                        : (departureAirport
                            ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('HH:mm')
                            : ''))
                    : ''}
                  onChange={(e) => {
                    if (!departureTime) return
                    const [hour, minute] = e.target.value.split(':').map(Number)
                    if (showCallsignActionRow) {
                      const current = DateTime.fromJSDate(departureTime, { zone: 'utc' })
                      const updated = current.set({ hour, minute })
                      setDepartureTime(updated.toJSDate())
                    } else {
                      if (!departureAirport) return
                      const timezone = getAirportTimezone(departureAirport)
                      const currentDateTime = DateTime.fromJSDate(departureTime, { zone: timezone })
                      const updated = currentDateTime.set({ hour, minute })
                      setDepartureTime(updated.toJSDate())
                    }
                  }}
                  disabled={!departureAirport && !callsignSearchResult}
                />
              </div>
            </div>
          </div>

          {(showCallsignActionRow || (showRouteActionRow && arrivalAirport)) && (
            <button
              className="calculate-pill"
              onClick={showRouteActionRow ? calculateFlight : handleCallsignStart}
              disabled={showRouteActionRow
                ? (!airports || departureCode.length !== 3 || arrivalCode.length !== 3 || departureCode === arrivalCode)
                : false
              }
            >
              {showRouteActionRow ? 'CALCULATE' : 'START'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
