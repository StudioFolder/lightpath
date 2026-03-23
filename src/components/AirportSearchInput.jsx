import { useState, useEffect, useRef } from 'react'

export default function AirportSearchInput({ label, code, airport, searchAirports, onSelect, onSearchChange, onClear }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef(null)

  const showLabel = !!airport

  const [carouselIndex, setCarouselIndex] = useState(0)
  const carouselWords = ['City', 'Airport', 'IATA code']
  const [isFocused, setIsFocused] = useState(false)
  

  useEffect(() => {
    const interval = setInterval(() => {
      setCarouselIndex(prev => (prev + 1) % carouselWords.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="input-group">
      <label style={{
        opacity: showLabel ? 1 : 0,
        maxHeight: showLabel ? '20px' : '0px',
        marginBottom: showLabel ? '4px' : '0px',
        transition: 'opacity 0.15s ease, max-height 0.15s ease, margin-bottom 0.15s ease',
        pointerEvents: 'none'
      }}>{label}</label>
      <div className="autocomplete-container">
        <svg className="input-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input 
          ref={inputRef}
          type="text"
          value={airport ? code : search}
          className={airport ? 'has-clear' : ''}
          placeholder=""
          onChange={(e) => {
            const value = e.target.value
            setSearch(value)
            onSearchChange()
            const searchResults = searchAirports(value)
            setResults(searchResults)
            setShowSuggestions(searchResults.length > 0)
            setSelectedIndex(-1)
          }}
          onFocus={() => {
            setIsFocused(true)
            if (search.length >= 2) {
              const searchResults = searchAirports(search)
              setResults(searchResults)
              setShowSuggestions(searchResults.length > 0)
            }
          }}
          onBlur={() => {
            setIsFocused(false)
            setTimeout(() => setShowSuggestions(false), 200)
          }}
          onKeyDown={(e) => {
            if (!showSuggestions) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelectedIndex(prev => prev < results.length - 1 ? prev + 1 : prev)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelectedIndex(prev => prev > 0 ? prev - 1 : -1)
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
              e.preventDefault()
              onSelect(results[selectedIndex])
              setSearch('')
              setShowSuggestions(false)
            }
          }}
        />

        {!search && !code && !isFocused && (
          <div className="placeholder-carousel">
            <div className="carousel-words">
              {carouselWords.map((word, i) => (
                <span
                  key={word}
                  className={`carousel-word ${i === carouselIndex ? 'active' : ''}`}
                >
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}

        {airport && (
          <>
            <span className="airport-name-inline">
              {airport.city} ({airport.country})
            </span>
            <button
              className="input-clear-btn"
              onMouseDown={(e) => {
                e.preventDefault()
                setSearch('')
                onClear()
                inputRef.current?.focus()
              }}
              aria-label={`Clear ${label} airport`}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </>
        )}

        {showSuggestions && results.length > 0 && (
          <div className="autocomplete-dropdown">
            {results.map((result, index) => (
              <div
                key={result.code}
                className={`autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  onSelect(result)
                  setSearch('')
                  setShowSuggestions(false)
                }}
              >
                <div className="autocomplete-line-1">
                  <span className="autocomplete-code">{result.code}</span>
                  <span className="autocomplete-name">{result.name}</span>
                </div>
                <div className="autocomplete-line-2">
                  <span className="autocomplete-city">{result.city}, {result.country}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}