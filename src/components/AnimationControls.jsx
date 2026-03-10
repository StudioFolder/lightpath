export default function AnimationControls({
  // State
  flightPath,
  flightResults,
  flightData,
  animationProgress,
  isPlaying,
  showFlightStats,
  departureCode,
  arrivalCode,
  isBWMode,
  // Callbacks
  onProgressChange,
  setIsPlaying,
  setIsPanelCollapsed,
  setShowFlightStats,
  // Functions
  getTimezoneAbbreviation,
  getLocalTimeAtAirport,
  getLocalDateAtAirport,
  formatFlightTime,
}) {
  const currentTime = flightData
    ? new Date(flightData.departureTime.getTime() + animationProgress * flightData.flightDurationMs)
    : null

  return (
    <div className={`animation-controls ${flightPath ? 'visible' : ''}`}>
      <div className={`flight-stats ${showFlightStats ? '' : 'hidden'} ${showFlightStats && animationProgress >= 1 ? 'slow-reveal' : ''}`}>
        <div className="flight-stat">
          <span className="flight-stat-label">Distance</span>
          <span className="flight-stat-value">{flightResults.distance.toLocaleString()} km</span>
        </div>
        <div className="flight-stat">
          <span className="flight-stat-label">Duration</span>
          <span className="flight-stat-value">{flightResults.durationHours}h {flightResults.durationMins}m</span>
        </div>
        <div className="flight-stat">
          <span className="flight-stat-label">Daylight</span>
          <span className="flight-stat-value">{flightResults.daylightHours}h {flightResults.daylightMins}m</span>
        </div>
        <div className="flight-stat">
          <span className="flight-stat-label">Darkness</span>
          <span className="flight-stat-value">{flightResults.darknessHours}h {flightResults.darknessMins}m</span>
        </div>
      </div>

      <div className="animation-header">
        <div className="airport-time airport-time-left">
          <span className="airport-code">
            {flightData && getTimezoneAbbreviation(flightData.departure)}
          </span>
          <span className="time-value">
            {flightData && getLocalTimeAtAirport(currentTime, flightData.departure)}
          </span>
          <span className="airport-date">
            {flightData && getLocalDateAtAirport(currentTime, flightData.departure)}
          </span>
        </div>

        <div className="flight-info-center"
          onMouseEnter={() => { if (!showFlightStats) setShowFlightStats(true) }}
          onMouseLeave={() => { if (isPlaying || animationProgress > 0) setShowFlightStats(false) }}
          onClick={() => {
            if ('ontouchstart' in window) {
              setShowFlightStats(prev => !prev)
            }
          }}
        >
          <div className="animation-route">
            <span>{departureCode}</span>
            <img 
              src={isBWMode ? "/plane-icon-bw.svg" : "/plane-icon.svg"} 
              className="route-plane-icon" 
              alt="plane" 
            />
            <span>{arrivalCode}</span>
          </div>
          <div className="animation-distance">
            {Math.round(flightResults.distance * animationProgress).toLocaleString()} km
          </div>
          <div className="animation-time">
            {formatFlightTime(animationProgress, flightResults)}
          </div>
        </div>

        <div className="airport-time airport-time-right">
          <span className="airport-code">
            {flightData && getTimezoneAbbreviation(flightData.arrival)}
          </span>
          <span className="time-value">
            {flightData && getLocalTimeAtAirport(currentTime, flightData.arrival)}
          </span>
          <span className="airport-date">
            {flightData && getLocalDateAtAirport(currentTime, flightData.arrival)}
          </span>
        </div>
      </div>
      
      <div className="slider-container">
        <svg 
          className="curved-slider" 
          viewBox="0 0 400 80" 
          preserveAspectRatio="xMidYMid meet"
          onMouseDown={(e) => {
            const svg = e.currentTarget
            const rect = svg.getBoundingClientRect()
            
            const handleMove = (moveEvent) => {
              const x = (moveEvent.clientX - rect.left) / rect.width * 400
              const clampedX = Math.max(25, Math.min(375, x))
              const newProgress = (clampedX - 25) / 350
              onProgressChange(newProgress)
            }
            
            const handleUp = () => {
              document.removeEventListener('mousemove', handleMove)
              document.removeEventListener('mouseup', handleUp)
              svg.style.cursor = 'pointer'
            }
            
            svg.style.cursor = 'grabbing'
            handleMove(e)
            document.addEventListener('mousemove', handleMove)
            document.addEventListener('mouseup', handleUp)
          }}
          onTouchStart={(e) => {
            const svg = e.currentTarget
            const rect = svg.getBoundingClientRect()
            
            const handleTouchMove = (touchEvent) => {
              touchEvent.preventDefault()
              const touch = touchEvent.touches[0]
              const x = (touch.clientX - rect.left) / rect.width * 400
              const clampedX = Math.max(25, Math.min(375, x))
              const newProgress = (clampedX - 25) / 350
              onProgressChange(newProgress)
            }
            
            const handleTouchEnd = () => {
              document.removeEventListener('touchmove', handleTouchMove)
              document.removeEventListener('touchend', handleTouchEnd)
            }
            
            if (e.touches.length > 0) {
              const touch = e.touches[0]
              const x = (touch.clientX - rect.left) / rect.width * 400
              const clampedX = Math.max(25, Math.min(375, x))
              const newProgress = (clampedX - 25) / 350
              onProgressChange(newProgress)
            }
            
            document.addEventListener('touchmove', handleTouchMove, { passive: false })
            document.addEventListener('touchend', handleTouchEnd)
          }}
        >
          <defs>
            <linearGradient id="arcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopOpacity="0.1" stopColor="white"/>
              <stop offset="15%" stopOpacity="1" stopColor="white"/>
              <stop offset="85%" stopOpacity="1" stopColor="white"/>
              <stop offset="100%" stopOpacity="0.1" stopColor="white"/>
            </linearGradient>
            
            <linearGradient id="arcGradientBW" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopOpacity="0.1" stopColor="#282828"/>
              <stop offset="15%" stopOpacity="1" stopColor="#282828"/>
              <stop offset="85%" stopOpacity="1" stopColor="#282828"/>
              <stop offset="100%" stopOpacity="0.1" stopColor="#282828"/>
            </linearGradient>
          </defs>
          
          <path
            d="M 0 65 Q 200 15, 400 65"
            fill="none"
            stroke={`url(#${isBWMode ? 'arcGradientBW' : 'arcGradient'})`}
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />
          
          {(() => {
            const t_start = 0.0625
            const t_end = 0.9375
            const t = t_start + animationProgress * (t_end - t_start)
            const x = 400 * t
            const y = 65 - 100 * t + 100 * t * t
            
            return (
              <circle
                cx={x}
                cy={y}
                r="9"
                fill={isBWMode ? "#282828" : "#ffffff"}
                opacity="0.9"
                style={{ pointerEvents: 'none' }}
              />
            )
          })()}
        </svg>
        
        <div className="time-labels">
          <img 
            src={isBWMode ? "/departure-icon-bw.svg" : "/departure-icon.svg"} 
            className="slider-icon" 
            alt="departure" 
          />
          <img 
            src={isBWMode ? "/arrival-icon-bw.svg" : "/arrival-icon.svg"} 
            className="slider-icon" 
            alt="arrival" 
          />
        </div>
      </div>
      
      <button 
        className="play-button"
        onClick={() => {
          if (animationProgress >= 1) {
            onProgressChange(0)
            setShowFlightStats(true)
          }
          if (!isPlaying) {
            setIsPanelCollapsed(true)
            setShowFlightStats(false)
          }
          setIsPlaying(!isPlaying)
        }}
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
    </div>
  )
}