# Lightpath — Phase 3: AirportSearchInput Component Extraction

**Date:** March 2026  
**Baseline version:** 0.7.x (post-scaling)  
**Goal:** Extract the duplicated airport search input into a reusable component

---

## Overview

The departure and arrival search inputs in App.jsx are near-identical blocks of ~80 lines of JSX each, with 8 mirrored state variables. This extraction creates a single `AirportSearchInput` component that handles its own search state internally and communicates selections back to App.jsx via callbacks.

---

## What Moves Into the Component

### State that becomes local to AirportSearchInput

These 8 state variables (× 2 for departure/arrival) are only used inside the search input JSX. They move into the component as local state:

| Current App.jsx State | Component Local State |
|---|---|
| `departureSearch` / `arrivalSearch` | `search` |
| `departureResults` / `arrivalResults` | `results` |
| `showDepartureSuggestions` / `showArrivalSuggestions` | `showSuggestions` |
| `selectedDepartureIndex` / `selectedArrivalIndex` | `selectedIndex` |

**Total: 8 state variables removed from App.jsx.**

### What stays in App.jsx

These are used throughout the app (calculateFlight, URL routing, animation panel, datetime picker, flight path drawing) and must remain:

- `departureCode` / `arrivalCode`
- `departureAirport` / `arrivalAirport`
- `airports` (the full airport database)
- `searchAirports()` function

---

## The Flight Path Cleanup Problem

Currently, the flight path cleanup useEffect watches `[departureSearch, arrivalSearch]`:

```javascript
useEffect(() => {
  if (!flightPath && !flightResults) return
  // ... clear flight path, labels, animation ...
}, [departureSearch, arrivalSearch])
```

With `departureSearch`/`arrivalSearch` moved into the child component, App.jsx can no longer watch them. 

**Solution:** Replace the dependency with a counter that increments whenever either search input changes. The component calls `onSearchChange()` when the user types, and App.jsx increments the counter:

```javascript
// App.jsx
const [searchChangeCount, setSearchChangeCount] = useState(0)

// Passed to component:
onSearchChange={() => setSearchChangeCount(c => c + 1)}

// Cleanup effect:
useEffect(() => {
  if (!flightPath && !flightResults) return
  // ... clear flight path ...
}, [searchChangeCount])
```

This is a clean, explicit signal that means "the user started editing an airport field."

---

## The URL Loading Problem

The URL param loading effect currently calls `setDepartureSearch('')` and `setArrivalSearch('')` to clear the search fields when loading from URL. With search state inside the component, we can't call these directly.

**Solution:** This is already handled naturally. The URL effect sets `departureCode` and `departureAirport`, which are passed as props. The component shows `code` when `selectedAirport` is set, so the search field automatically displays the code. No need to clear the search from outside — the component's `value` logic handles it:

```javascript
value={selectedAirport ? code : search}
```

We simply remove the `setDepartureSearch('')` and `setArrivalSearch('')` calls from the URL loading effect.

---

## Component API

```jsx
<AirportSearchInput
  label="Departure"                    // Field label text
  code={departureCode}                 // Selected IATA code (controlled by App)
  selectedAirport={departureAirport}   // Selected airport object (controlled by App)
  searchAirports={searchAirports}      // Search function from App
  onSelect={(code, airport) => {       // Called when user picks from dropdown
    setDepartureCode(code)
    setDepartureAirport(airport)
  }}
  onSearchChange={() => {              // Called when user types (clears flight)
    setDepartureCode('')
    setDepartureAirport(null)
    setSearchChangeCount(c => c + 1)
  }}
/>
```

The same component is used for arrival with the corresponding arrival state.

---

## New File: `src/components/AirportSearchInput.jsx`

```jsx
import { useState } from 'react'

function AirportSearchInput({ label, code, selectedAirport, searchAirports, onSelect, onSearchChange }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const handleChange = (e) => {
    const value = e.target.value
    setSearch(value)
    onSearchChange()
    
    const searchResults = searchAirports(value)
    setResults(searchResults)
    setShowSuggestions(searchResults.length > 0)
    setSelectedIndex(-1)
  }

  const handleFocus = () => {
    if (search.length >= 2) {
      const searchResults = searchAirports(search)
      setResults(searchResults)
      setShowSuggestions(searchResults.length > 0)
    }
  }

  const handleBlur = () => {
    setTimeout(() => setShowSuggestions(false), 200)
  }

  const handleKeyDown = (e) => {
    if (!showSuggestions) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => prev < results.length - 1 ? prev + 1 : prev)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => prev > 0 ? prev - 1 : -1)
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      const selected = results[selectedIndex]
      onSelect(selected.code, selected)
      setSearch('')
      setShowSuggestions(false)
    }
  }

  const handleSelect = (result) => {
    onSelect(result.code, result)
    setSearch('')
    setShowSuggestions(false)
  }

  return (
    <div className="input-group">
      <label>{label}</label>
      <div className="autocomplete-container">
        <input 
          type="text"
          value={selectedAirport ? code : search}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />

        {selectedAirport && (
          <span className="airport-name-inline">
            {selectedAirport.city} ({selectedAirport.country})
          </span>
        )}
                        
        {showSuggestions && results.length > 0 && (
          <div className="autocomplete-dropdown">
            {results.map((result, index) => (
              <div
                key={result.code}
                className={`autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelect(result)}
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

export default AirportSearchInput
```

---

## Changes to App.jsx

### Step 1: Add import and new state

Add at the top with other imports:
```javascript
import AirportSearchInput from './components/AirportSearchInput'
```

Add new state variable (with the other state declarations):
```javascript
const [searchChangeCount, setSearchChangeCount] = useState(0)
```

### Step 2: Remove 8 search-internal state variables

Delete these lines:
```javascript
const [departureSearch, setDepartureSearch] = useState('')
const [departureResults, setDepartureResults] = useState([])
const [showDepartureSuggestions, setShowDepartureSuggestions] = useState(false)
const [selectedDepartureIndex, setSelectedDepartureIndex] = useState(-1)
const [arrivalSearch, setArrivalSearch] = useState('')
const [arrivalResults, setArrivalResults] = useState([])
const [showArrivalSuggestions, setShowArrivalSuggestions] = useState(false)
const [selectedArrivalIndex, setSelectedArrivalIndex] = useState(-1)
```

### Step 3: Update the flight path cleanup useEffect

Change the dependency from:
```javascript
}, [departureSearch, arrivalSearch])
```
To:
```javascript
}, [searchChangeCount])
```

### Step 4: Update the URL param loading effect

Remove these two lines from the URL loading useEffect:
```javascript
setDepartureSearch('') // Clear search like the onClick does
setArrivalSearch('') // Clear search like the onClick does
```

### Step 5: Replace JSX

Replace the departure search block (the entire `<div className="input-group">` containing the departure input, from `<label>Departure</label>` through the closing `</div>` of the autocomplete-container) with:

```jsx
<AirportSearchInput
  label="Departure"
  code={departureCode}
  selectedAirport={departureAirport}
  searchAirports={searchAirports}
  onSelect={(code, airport) => {
    setDepartureCode(code)
    setDepartureAirport(airport)
  }}
  onSearchChange={() => {
    setDepartureCode('')
    setDepartureAirport(null)
    setSearchChangeCount(c => c + 1)
  }}
/>
```

Replace the arrival search block (same structure) with:

```jsx
<AirportSearchInput
  label="Arrival"
  code={arrivalCode}
  selectedAirport={arrivalAirport}
  searchAirports={searchAirports}
  onSelect={(code, airport) => {
    setArrivalCode(code)
    setArrivalAirport(airport)
  }}
  onSearchChange={() => {
    setArrivalCode('')
    setArrivalAirport(null)
    setSearchChangeCount(c => c + 1)
  }}
/>
```

---

## Testing Checklist

### Basic Search
- [ ] Type in departure field — suggestions appear after 2 characters
- [ ] Arrow keys navigate suggestions, Enter selects
- [ ] Click on suggestion selects it
- [ ] Selected airport shows code + city/country
- [ ] Same behavior for arrival field

### Flight Path Interaction
- [ ] Calculate a flight — path draws correctly
- [ ] Start typing in either field — flight path clears
- [ ] Calculate another flight — works correctly

### URL Loading
- [ ] Load a URL like `/flight/JFK-LHR/2026-03-01/1430` — both fields populate correctly
- [ ] After URL load, typing in a field clears the flight

### Edge Cases
- [ ] Blur (clicking away) closes dropdown
- [ ] Focus with existing search text reopens dropdown
- [ ] Same airport validation still works (Calculate button disabled)
- [ ] Mobile: search inputs work with touch
- [ ] BW mode: search inputs style correctly

---

## Summary

| Metric | Before | After |
|---|---|---|
| App.jsx state variables | 14 (search-related) | 7 (code, airport, airports + searchChangeCount) |
| App.jsx JSX lines (search) | ~160 | ~30 |
| New files | 0 | 1 (AirportSearchInput.jsx, ~90 lines) |
| Net lines saved | — | ~70 |

The component encapsulates all search interaction (typing, keyboard navigation, dropdown visibility) while App.jsx retains ownership of the selected airport data that the rest of the app depends on.
