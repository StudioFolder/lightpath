import { useState } from 'react'

/**
 * Reusable airport search input with autocomplete dropdown.
 * Manages its own search/suggestions state internally.
 * Communicates selected airport back to parent via onSelect callback.
 * 
 * @param {string} label - "Departure" or "Arrival"
 * @param {string} code - Selected IATA code (controlled by parent)
 * @param {object} airport - Selected airport object { city, country, ... } (controlled by parent)
 * @param {function} searchAirports - Search function: (query) => results[]
 * @param {function} onSelect - Called when user selects: ({ code, city, country, lat, lon }) => void
 * @param {function} onSearchChange - Called when user starts typing (signals parent to clear flight)
 */
export default function AirportSearchInput({ label, code, airport, searchAirports, onSelect, onSearchChange }) {
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
              setSelectedIndex(prev => 
                prev < results.length - 1 ? prev + 1 : prev
              )
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelectedIndex(prev => prev > 0 ? prev - 1 : -1)
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
              e.preventDefault()
              const selected = results[selectedIndex]
              onSelect(selected)
              setSearch('')
              setShowSuggestions(false)
            }
          }}
        />

        {airport && (
          <span className="airport-name-inline">
            {airport.city} ({airport.country})
          </span>
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