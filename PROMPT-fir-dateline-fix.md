# Fix: Remove visible lines along the International Date Line in FIR layer

## Problem

In `src/App.jsx`, the FIR regions rendering effect (around line 2284) builds `THREE.Line` objects from GeoJSON polygon rings. Some FIR polygons (e.g. ANCHORAGE OCEANIC) have edges that run along exactly ±180° longitude — both endpoints of a segment sit at `lon ≈ 180` or `lon ≈ -180`. On the 3D globe these edges appear as a visible vertical line along the International Date Line, which shouldn't be there since it's just an artifact of how the GIS data was split.

## Fix

Modify the `buildRingLine` function (around line 2348) to skip segments where both endpoints are on the date line.

Currently, the function builds one continuous `THREE.Line` from the entire ring. Instead:

1. After subdividing the ring, iterate through the points and split the ring into **separate segments** whenever two consecutive vertices both have `|lon| >= 179.5`.
2. For each continuous segment (between date-line breaks), create a separate `THREE.Line` with the same material and `userData`.

Here's the logic to replace the current `buildRingLine`:

```js
const buildRingLine = (ring, featureIndex, groupKey) => {
  const subdividedRing = subdivideRing(ring)

  // Split into segments, breaking where both endpoints are on the date line
  const isDateLineLon = (lon) => Math.abs(Math.abs(lon) - 180) < 0.5

  const segments = []
  let currentSegment = []

  for (let i = 0; i < subdividedRing.length; i++) {
    const coord = subdividedRing[i]
    const prevCoord = i > 0 ? subdividedRing[i - 1] : null

    // If both this and previous point are on the date line, break the segment
    if (prevCoord && isDateLineLon(coord[0]) && isDateLineLon(prevCoord[0])) {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment)
      }
      currentSegment = [coord]
    } else {
      currentSegment.push(coord)
    }
  }
  if (currentSegment.length >= 2) {
    segments.push(currentSegment)
  }

  // Create a THREE.Line for each segment
  for (const segment of segments) {
    const points = segment.map(coord =>
      latLonToVector3(coord[1], coord[0], 2.005)
    )
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: isBWModeRef.current ? 0x0f0f0f : 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false
    })
    const line = new THREE.Line(lineGeometry, lineMaterial)
    line.userData.featureIndex = featureIndex
    firGroup.add(line)
  }
}
```

## Scope

Only modify the `buildRingLine` function inside the FIR rendering `useEffect` in `src/App.jsx`. Do not change anything else.
