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
  getLocalDateTimeString,
  getAirportTimezone,
}) {
  return (
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
        className="panel-subtitle"
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
        <AirportSearchInput
          label="Departure"
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

        <div className="swap-airports-row">
          {(departureAirport && arrivalAirport) && (
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
              ⇅
            </button>
          )}
        </div>

        <AirportSearchInput
          label="Arrival"
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

        <div className="datetime-group" style={{
          opacity: departureAirport ? 1 : 0,
          maxHeight: departureAirport ? '80px' : '0px',
          marginBottom: departureAirport ? '12px' : '0px',
          overflow: 'hidden',
          transition: 'opacity 0.15s ease, max-height 0.15s ease, margin-bottom 0.15s ease',
          pointerEvents: departureAirport ? 'all' : 'none'
        }}>
          <label style={{
            opacity: departureAirport ? 1 : 0,
            maxHeight: departureAirport ? '20px' : '0px',
            marginBottom: departureAirport ? '4px' : '0px',
            transition: 'opacity 0.15s ease, max-height 0.15s ease, margin-bottom 0.15s ease',
            pointerEvents: 'none'
          }}>Departure Time (Local)</label>
          <input 
            type="datetime-local"
            value={departureAirport && departureTime ? getLocalDateTimeString(departureTime, departureAirport) : ''}
            onChange={(e) => {
              if (!departureAirport) return
              const timezone = getAirportTimezone(departureAirport)
              const localDateTime = DateTime.fromISO(e.target.value, { zone: timezone })
              setDepartureTime(localDateTime.toJSDate())
            }}
            disabled={!departureAirport}
          />
        </div>

        <button 
          onClick={calculateFlight}
          disabled={
            !airports || 
            departureCode.length !== 3 || 
            arrivalCode.length !== 3 || 
            departureCode === arrivalCode
          }
          style={{
            opacity: departureAirport ? 1 : 0,
            maxHeight: departureAirport ? '60px' : '0px',
            paddingTop: departureAirport ? '10px' : '0px',
            paddingBottom: departureAirport ? '10px' : '0px',
            overflow: 'hidden',
            transition: isMobile ? 'none' : 'opacity 0.15s ease, max-height 0.15s ease, padding 0.15s ease',
            pointerEvents: departureAirport ? 'all' : 'none'
          }}
        >
          {!airports ? 'Loading airports...' : 'Calculate Flight'}
        </button>
      </div>
    </div>
  )
}
