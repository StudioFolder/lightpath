import { useState } from 'react'

export default function AirportSearchInput({ label, code, airport, searchAirports, onSelect, onSearchChange, onClear }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  return (
    <div className="input-group">
      <label>{label}</label>
      <div className="autocomplete-container">
        <input 
          type="text"
          value={airport ? code : search}
          className={airport ? 'has-clear' : ''}
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
            if (search.length >= 2) {
              const searchResults = searchAirports(search)
              setResults(searchResults)
              setShowSuggestions(searchResults.length > 0)
            }
          }}
          onBlur={() => {
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

        {airport && (
          <>
            <span className="airport-name-inline">
              {airport.city} ({airport.country})
            </span>
            <button
            className="input-clear-btn"
            onClick={() => {
                setSearch('')
                onClear()
            }}
            aria-label={`Clear ${label} airport`}
            >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
                <span className="autocomplete-code">{result.code}</span>
                <span className="autocomplete-city">{result.city}, {result.country}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}