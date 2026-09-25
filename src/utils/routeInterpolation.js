import * as THREE from 'three'

/**
 * Centripetal Catmull-Rom curve with adjustable tangent strength.
 *
 * Centripetal parameterisation cannot form loops or cusps between control
 * points, however unevenly they are spaced (uniform Catmull-Rom can, which
 * showed up as heading flips on FR24 routes with closely spaced events).
 * `tension` scales the tangents: 1 matches THREE.CatmullRomCurve3's
 * 'centripetal' mode, lower values keep segments straighter between
 * waypoints and concentrate the turning near them.
 *
 * Parameterisation matches CatmullRomCurve3 (t spread uniformly across
 * segments), so getLengths(points.length - 1) still yields per-control-point
 * arc lengths.
 */
export class RouteCurve extends THREE.Curve {
  constructor(points = [], tension = 1) {
    super()
    this.points = points
    this.tension = tension
  }

  getPoint(t, optionalTarget = new THREE.Vector3()) {
    const pts = this.points
    const l = pts.length
    const p = (l - 1) * t
    let i = Math.floor(p)
    let w = p - i
    if (i >= l - 1) {
      i = l - 2
      w = 1
    }

    const p1 = pts[i]
    const p2 = pts[i + 1]
    // Open curve: extrapolate virtual end points, as CatmullRomCurve3 does
    const p0 = i > 0 ? pts[i - 1] : p1.clone().multiplyScalar(2).sub(p2)
    const p3 = i + 2 < l ? pts[i + 2] : p2.clone().multiplyScalar(2).sub(p1)

    let dt0 = Math.sqrt(p0.distanceTo(p1))
    let dt1 = Math.sqrt(p1.distanceTo(p2))
    let dt2 = Math.sqrt(p2.distanceTo(p3))
    if (dt1 < 1e-4) dt1 = 1.0
    if (dt0 < 1e-4) dt0 = dt1
    if (dt2 < 1e-4) dt2 = dt1

    const w2 = w * w
    const w3 = w2 * w
    const h00 = 2 * w3 - 3 * w2 + 1
    const h10 = w3 - 2 * w2 + w
    const h01 = -2 * w3 + 3 * w2
    const h11 = w3 - w2
    const k = dt1 * this.tension

    for (const axis of ['x', 'y', 'z']) {
      const x0 = p0[axis], x1 = p1[axis], x2 = p2[axis], x3 = p3[axis]
      const m1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * k
      const m2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * k
      optionalTarget[axis] = h00 * x1 + h10 * m1 + h01 * x2 + h11 * m2
    }

    return optionalTarget
  }
}

/**
 * Interpolate a timestamp at a given arc-length fraction along the route.
 *
 * @param {Array}  controlPoints      - Array of { lat, lon, timestamp }
 * @param {number} fraction           - Arc-length fraction 0–1
 * @param {Array}  [arcLengthFractions] - Per-control-point arc-length fractions.
 *   If omitted, falls back to linear interpolation between first and last timestamps.
 */
export function interpolateTimestamp(controlPoints, fraction, arcLengthFractions) {
  if (!arcLengthFractions) {
    const t0 = new Date(controlPoints[0].timestamp).getTime();
    const t1 = new Date(controlPoints[controlPoints.length - 1].timestamp).getTime();
    return new Date(t0 + fraction * (t1 - t0));
  }

  // Find the segment [i, i+1] that contains this arc-length fraction
  let i = arcLengthFractions.length - 2;
  for (let j = 0; j < arcLengthFractions.length - 1; j++) {
    if (fraction <= arcLengthFractions[j + 1]) {
      i = j;
      break;
    }
  }

  const segSpan = arcLengthFractions[i + 1] - arcLengthFractions[i];
  const t = segSpan === 0 ? 0 : (fraction - arcLengthFractions[i]) / segSpan;

  const ms0 = new Date(controlPoints[i].timestamp).getTime();
  const ms1 = new Date(controlPoints[i + 1].timestamp).getTime();
  return new Date(ms0 + t * (ms1 - ms0));
}
