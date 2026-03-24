import { useState, useRef, useEffect } from 'react'
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
  searchAirlines,
  calculateFlight,
  handleCallsignSearch,
  handleCallsignStart,
  getAirportTimezone,
}) {

  const [routePhase, setRoutePhase] = useState('idle') // 'idle' | 'animating' | 'ready'
  const [panelFullyOpen, setPanelFullyOpen] = useState(!isPanelCollapsed)
  const dateInputRef = useRef(null)
  const panelRef = useRef(null)
  const airportColumnsRef = useRef(null)
  const callsignInputRef = useRef(null)

  // Callsign carousel
  const [callsignCarouselIndex, setCallsignCarouselIndex] = useState(0)
  const [isCallsignFocused, setIsCallsignFocused] = useState(false)
  const callsignCarouselWords = ['Airline', 'IATA code', 'ICAO code']
  useEffect(() => {
    const interval = setInterval(() => {
      setCallsignCarouselIndex(prev => (prev + 1) % callsignCarouselWords.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Two-phase airline input state
  const [selectedAirline, setSelectedAirline] = useState(null)
  const [flightNumber, setFlightNumber] = useState('')
  const [airlineSearch, setAirlineSearch] = useState('')
  const [airlineResults, setAirlineResults] = useState([])
  const [showAirlineDropdown, setShowAirlineDropdown] = useState(false)
  const [airlineDropdownIndex, setAirlineDropdownIndex] = useState(-1)
  // Set when phase-1 text already is a valid IATA + digits (direct entry, no dropdown needed)
  const [directEntryAirline, setDirectEntryAirline] = useState(null)

  // Sync callsignInput to combined value whenever airline/flightNumber change
  useEffect(() => {
    if (selectedAirline) {
      setCallsignInput(selectedAirline.iata + flightNumber)
    } else if (directEntryAirline) {
      setCallsignInput(airlineSearch)
    }
  }, [selectedAirline, flightNumber, directEntryAirline, airlineSearch])

  function resetAirlineState() {
    setSelectedAirline(null)
    setFlightNumber('')
    setAirlineSearch('')
    setAirlineResults([])
    setShowAirlineDropdown(false)
    setAirlineDropdownIndex(-1)
    setDirectEntryAirline(null)
  }

  // After airline is selected, position cursor at end of IATA prefix
  useEffect(() => {
    if (selectedAirline && callsignInputRef.current) {
      const pos = selectedAirline.iata.length
      callsignInputRef.current.focus()
      callsignInputRef.current.setSelectionRange(pos, pos)
    }
  }, [selectedAirline])

  function selectAirline(airline) {
    setSelectedAirline(airline)
    setAirlineSearch('')
    setAirlineResults([])
    setShowAirlineDropdown(false)
    setAirlineDropdownIndex(-1)
  }

  useEffect(() => {
    if (isPanelCollapsed) {
      setPanelFullyOpen(false)
    } else {
      const timer = setTimeout(() => setPanelFullyOpen(true), 460)
      return () => clearTimeout(timer)
    }
  }, [isPanelCollapsed])

  useEffect(() => {
    if (searchMode === 'route' && departureAirport && arrivalAirport && routePhase === 'idle') {
      setRoutePhase('animating')
    }
  }, [searchMode, departureAirport, arrivalAirport, routePhase])

  useEffect(() => {
    if (routePhase !== 'animating') return
    const el = airportColumnsRef.current
    if (!el) return

    let done = false
    const complete = () => {
      if (done) return
      done = true
      setRoutePhase('ready')
    }

    const fallbackTimer = setTimeout(complete, 500)
    el.addEventListener('transitionend', complete, { once: true })

    return () => {
      done = true
      clearTimeout(fallbackTimer)
      el.removeEventListener('transitionend', complete)
    }
  }, [routePhase])

  function expandPanel() {
    if (!isPanelCollapsed) return
    if (!isMobile) {
      setIsPanelCollapsed(false)
      setShowFlightStats(false)
      return
    }
    setIsPanelFading(true)
    const el = panelRef.current
    if (el) {
      el.addEventListener('transitionend', () => {
        setIsPanelCollapsed(false)
        setShowFlightStats(false)
        setIsPanelFading(false)
      }, { once: true })
    }
  }

  function switchToRoute() {
    expandPanel()
    setSearchMode('route')
    setCallsignError(null)
    // Inherit airports from callsign result if route fields are empty
    if (!departureAirport && !arrivalAirport && resolvedOrig && resolvedDest) {
      setDepartureCode(resolvedOrig.iata || resolvedOrig.icao)
      setDepartureAirport(resolvedOrig)
      setArrivalCode(resolvedDest.iata || resolvedDest.icao)
      setArrivalAirport(resolvedDest)
      setRoutePhase('ready')
    } else if (departureAirport && arrivalAirport) {
      setRoutePhase('ready')
    } else {
      setRoutePhase('idle')
    }
  }

  function switchToCallsign() {
    expandPanel()
    setSearchMode('callsign')
    setCallsignError(null)
    // Clear route airports if they were manually entered (no callsign result backing them)
    if (!callsignSearchResult) {
      setCallsignInput('')
      resetAirlineState()
      setDepartureCode('')
      setDepartureAirport(null)
      setArrivalCode('')
      setArrivalAirport(null)
    }
    setRoutePhase('idle')
  }

  const isSubtitleHidden = routePhase !== 'idle' || !!callsignSearchResult
  const isSubtitleFaded = !isSubtitleHidden && !!callsignError

  // Resolve airports from ICAO codes when a callsign result is available
  const resolvedOrig = callsignSearchResult && airportsIcao
    ? airportsIcao[callsignSearchResult.summary.orig_icao] ?? null
    : null
  const resolvedDest = callsignSearchResult && airportsIcao
    ? airportsIcao[callsignSearchResult.summary.dest_icao_actual ?? callsignSearchResult.summary.dest_icao] ?? null
    : null

  // Determine whether to show the action row
  const showRouteActionRow   = searchMode === 'route'    && departureAirport && panelFullyOpen
  const showCallsignActionRow = searchMode === 'callsign' && callsignSearchResult && panelFullyOpen

  const hasAirlineInput = !!(airlineSearch || selectedAirline)
  const canSearch = !!(selectedAirline && flightNumber.trim()) || !!(directEntryAirline)

  return (
    <div className={`flight-input-wrapper ${isPanelCollapsed ? 'collapsed' : ''}`}>
      <div
        ref={panelRef}
        className={`flight-input ${isPanelCollapsed ? 'collapsed' : ''} ${isPanelFading ? 'fading' : ''} ${routePhase === 'ready' ? 'route-mode' : ''} ${searchMode === 'callsign' && callsignSearchResult ? 'callsign-result' : ''}`}
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
            const cleanup = () => {
              setShowMobileMenu(false)
              setIsMobileMenuClosing(false)
              setIsMobileMenuAnimating(false)
            }
            const menuEl = document.querySelector('.mobile-menu')
            if (menuEl) {
              const fallbackTimer = setTimeout(cleanup, 350)
              menuEl.addEventListener('animationend', () => {
                clearTimeout(fallbackTimer)
                cleanup()
              }, { once: true })
            } else {
              cleanup()
            }
          }
          setIsPanelFading(true)
          const el = panelRef.current
          if (el) {
            el.addEventListener('transitionend', () => {
              setIsPanelCollapsed(false)
              setShowFlightStats(false)
              setIsPanelFading(false)
            }, { once: true })
          }
        } : undefined}
        style={isPanelCollapsed ? { cursor: 'pointer' } : undefined}
      >
        <div className="panel-header">
          <img src={isBWMode ? '/search-icon-bw.svg' : '/search-icon.svg'} width="20" height="20" alt="" className="panel-header-search-icon" />
          <span className="collapsed-mode-label">{searchMode === 'callsign' ? 'Flight' : 'Route'}</span>
          <div className="mode-toggle">
            <div className="mode-toggle-indicator" style={{ transform: `translateX(${searchMode === 'callsign' ? '100%' : '0'})` }} />
            <span
              className={`mode-toggle-btn ${searchMode === 'route' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); switchToRoute() }}
            >
              ROUTE
            </span>
            <span
              className={`mode-toggle-btn ${searchMode === 'callsign' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); switchToCallsign() }}
            >
              FLIGHT
            </span>
          </div>
          {!isPanelCollapsed && (
            <button
              className="collapse-button"
              onClick={(e) => {
                e.stopPropagation()
                if (!isMobile) {
                  setIsPanelCollapsed(true)
                  return
                }
                setIsPanelFading(true)
                const el = panelRef.current
                if (el) {
                  el.addEventListener('transitionend', () => {
                    setIsPanelCollapsed(true)
                    setIsPanelFading(false)
                  }, { once: true })
                }
              }}
              aria-label="Collapse panel"
            >
              <svg className="collapse-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>

        <p
          className={`panel-subtitle ${isSubtitleHidden ? 'hidden' : ''} ${isSubtitleFaded ? 'faded' : ''}`}
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
            <>
            {routePhase === 'ready' && (
              <div className="callsign-result-label">Great Circle Route</div>
            )}
            <div ref={airportColumnsRef} className={`airport-columns ${routePhase === 'ready' ? 'route-mode' : ''} ${routePhase === 'animating' ? 'fading-out' : ''}`}>
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
            </>
          ) : (
            /* callsign mode */
            callsignError ? (
              <div className="callsign-error">
                <p className="callsign-error-message">{callsignError}</p>
                <span
                  className="callsign-error-back"
                  onClick={() => setCallsignError(null)}
                >back</span>
              </div>
            ) : callsignSearchResult ? (
              <>
              <div className="callsign-result-label">
                {(callsignSearchResult.summary?.flight || callsignInput).replace(/^([A-Z]{2,3})(\d.*)$/, '$1 $2')}
                <button
                  className="callsign-result-clear"
                  onClick={() => {
                    setCallsignSearchResult(null)
                    setCallsignInput('')
                    resetAirlineState()
                    document.activeElement?.blur()
                  }}
                  aria-label="Clear flight"
                ><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
              </div>
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

                <div className="swap-airports-column">
                  <img
                    src={isBWMode ? "/plane-icon-bw.svg" : "/plane-icon.svg"}
                    className="route-plane-icon"
                    alt="plane"
                  />
                </div>

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
              </>
            ) : (
              <>
                <div className="airport-columns callsign-input-columns">
                  <div className="airport-column callsign-input-column">
                    <span className="column-label">FLIGHT NUMBER</span>
                    <div className="input-group">
                      <div className="autocomplete-container">

                        <input
                          ref={callsignInputRef}
                          type="text"
                          value={selectedAirline ? selectedAirline.iata + flightNumber : airlineSearch}
                          placeholder=""
                          disabled={isCallsignSearching}
                          onChange={(e) => {
                            if (selectedAirline) {
                              const iata = selectedAirline.iata
                              const val = e.target.value.toUpperCase()
                              if (val.startsWith(iata)) {
                                const digits = val.slice(iata.length).replace(/\D/g, '').slice(0, 4)
                                setFlightNumber(digits)
                              }
                              // if IATA prefix was edited, ignore — controlled input restores it
                            } else {
                              const value = e.target.value.toUpperCase()
                              setAirlineSearch(value)
                              // Direct entry check: ^[A-Z]{2}\d+$
                              const directMatch = /^([A-Z]{2})(\d+)$/.exec(value)
                              if (directMatch) {
                                const prefix = directMatch[1]
                                const results = searchAirlines(prefix)
                                const exact = results.find(a => a.iata === prefix) || null
                                setDirectEntryAirline(exact)
                                setAirlineResults([])
                                setShowAirlineDropdown(false)
                              } else {
                                setDirectEntryAirline(null)
                                if (value.length >= 2) {
                                  const results = searchAirlines(value)
                                  setAirlineResults(results)
                                  setShowAirlineDropdown(results.length > 0)
                                } else {
                                  setAirlineResults([])
                                  setShowAirlineDropdown(false)
                                }
                              }
                              setAirlineDropdownIndex(-1)
                            }
                          }}
                          onFocus={() => {
                            setIsCallsignFocused(true)
                            if (!selectedAirline && airlineSearch.length >= 2) {
                              const results = searchAirlines(airlineSearch)
                              setAirlineResults(results)
                              setShowAirlineDropdown(results.length > 0)
                            }
                          }}
                          onBlur={() => {
                            setIsCallsignFocused(false)
                            setTimeout(() => setShowAirlineDropdown(false), 200)
                          }}
                          onKeyDown={(e) => {
                            if (selectedAirline) {
                              const iata = selectedAirline.iata
                              if (e.key === 'Backspace' && !flightNumber) {
                                setSelectedAirline(null)
                                return
                              }
                              if (e.key === 'Enter' && canSearch) {
                                handleCallsignSearch(iata + flightNumber)
                                return
                              }
                              // Keep cursor after IATA prefix
                              if ((e.key === 'ArrowLeft' || e.key === 'Home') &&
                                  callsignInputRef.current?.selectionStart <= iata.length) {
                                e.preventDefault()
                                callsignInputRef.current.setSelectionRange(iata.length, iata.length)
                              }
                            } else {
                              if (e.key === 'Enter' && directEntryAirline) {
                                e.preventDefault()
                                handleCallsignSearch(airlineSearch)
                                return
                              }
                              if (!showAirlineDropdown) return
                              if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setAirlineDropdownIndex(prev => prev < airlineResults.length - 1 ? prev + 1 : prev)
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setAirlineDropdownIndex(prev => prev > 0 ? prev - 1 : -1)
                              } else if (e.key === 'Enter' && airlineDropdownIndex >= 0) {
                                e.preventDefault()
                                selectAirline(airlineResults[airlineDropdownIndex])
                              }
                            }
                          }}
                        />

                        {/* Placeholder carousel — phase 1 only, empty + unfocused */}
                        {!selectedAirline && !airlineSearch && !isCallsignFocused && (
                          <div className="placeholder-carousel">
                            <div className="carousel-words">
                              {callsignCarouselWords.map((word, i) => (
                                <span
                                  key={word}
                                  className={`carousel-word ${i === callsignCarouselIndex ? 'active' : ''}`}
                                >
                                  {word}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Clear button */}
                        {hasAirlineInput && (
                          <button
                            className="input-clear-btn"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setCallsignInput('')
                              resetAirlineState()
                            }}
                            aria-label="Clear flight input"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                              <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}

                        {/* Enter button */}
                        {canSearch && (
                          <button
                            className={`callsign-enter-btn${isCallsignSearching ? ' loading' : ''}`}
                            onClick={() => selectedAirline
                              ? handleCallsignSearch(selectedAirline.iata + flightNumber)
                              : handleCallsignSearch(airlineSearch)
                            }
                            disabled={isCallsignSearching}
                            aria-label="Search flight"
                          >
                            <img src={isBWMode ? '/enter-icon-bw.svg' : '/enter-icon.svg'} width="16" height="16" alt="" />
                          </button>
                        )}

                        {/* Airline dropdown */}
                        {showAirlineDropdown && airlineResults.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {airlineResults.map((airline, index) => (
                              <div
                                key={airline.iata}
                                className={`autocomplete-item ${index === airlineDropdownIndex ? 'selected' : ''}`}
                                onClick={() => selectAirline(airline)}
                              >
                                <div className="autocomplete-line-1">
                                  <span className="autocomplete-code">{airline.iata}</span>
                                  <span className="autocomplete-name">{airline.name}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )
          )}
        </div>
      </div>

      <div className={`flight-action-row ${showRouteActionRow || showCallsignActionRow ? 'visible' : ''}`}>
          <div className="datetime-pill">
            <div className="datetime-display">
              <div className="datetime-field" onClick={() => dateInputRef.current?.showPicker()}>
                <img src={isBWMode ? "/date-icon-bw.svg" : "/date-icon.svg"} alt="Date" className="datetime-icon" />
                <span className="datetime-value">
                  {showCallsignActionRow && departureTime
                    ? DateTime.fromJSDate(departureTime, { zone: resolvedOrig ? getAirportTimezone(resolvedOrig) : 'utc' }).toFormat(isMobile ? 'MMM d' : 'MMM d, yyyy')
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
                          ? DateTime.fromJSDate(departureTime, { zone: resolvedOrig ? getAirportTimezone(resolvedOrig) : 'utc' }).toFormat('yyyy-MM-dd')
                          : (departureAirport
                              ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('yyyy-MM-dd')
                              : ''))
                      : ''}
                    onChange={(e) => {
                      if (!departureTime) return
                      if (showCallsignActionRow) {
                        const current = DateTime.fromJSDate(departureTime, { zone: resolvedOrig ? getAirportTimezone(resolvedOrig) : 'utc' })
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
                  tabIndex={showRouteActionRow || showCallsignActionRow ? 0 : -1}
                  value={departureTime
                    ? (showCallsignActionRow
                        ? DateTime.fromJSDate(departureTime, { zone: resolvedOrig ? getAirportTimezone(resolvedOrig) : 'utc' }).toFormat('HH:mm')
                        : (departureAirport
                            ? DateTime.fromJSDate(departureTime, { zone: getAirportTimezone(departureAirport) }).toFormat('HH:mm')
                            : ''))
                    : ''}
                  onChange={(e) => {
                    if (!departureTime) return
                    const [hour, minute] = e.target.value.split(':').map(Number)
                    if (showCallsignActionRow) {
                      const current = DateTime.fromJSDate(departureTime, { zone: resolvedOrig ? getAirportTimezone(resolvedOrig) : 'utc' })
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
    </div>
  )
}
