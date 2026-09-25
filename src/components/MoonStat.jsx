export default function MoonStat({ data, isBWMode }) {
  if (!data) return null

  const { windowVisibleMs, illumination, phase, phaseName } = data

  // Convert window-visible time to hours and minutes
  const totalMins = Math.round(windowVisibleMs / (1000 * 60))
  if (totalMins === 0) return null
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60

  // SVG moon glyph parameters
  const radius = 8
  const centerX = radius
  const centerY = radius
  const svgSize = radius * 2

  // Compute terminator ellipse horizontal semi-axis
  const terminatorSemiAxis = radius * Math.abs(1 - 2 * illumination)

  // Determine if waxing (phase < 0.5) or waning (phase >= 0.5)
  const isWaxing = phase < 0.5

  // Build the two-arc path for the moon glyph
  // The terminator bulges right for waxing, left for waning
  const litArcPath = illumination < 0.5
    ? // Less than half illuminated - lit portion is a crescent
      `M ${centerX},${centerY - radius}
       A ${radius},${radius} 0 0 ${isWaxing ? 1 : 0} ${centerX},${centerY + radius}
       A ${terminatorSemiAxis},${radius} 0 0 ${isWaxing ? 0 : 1} ${centerX},${centerY - radius}
       Z`
    : // More than half illuminated - lit portion is gibbous or full
      `M ${centerX},${centerY - radius}
       A ${radius},${radius} 0 0 ${isWaxing ? 1 : 0} ${centerX},${centerY + radius}
       A ${terminatorSemiAxis},${radius} 0 0 ${isWaxing ? 1 : 0} ${centerX},${centerY - radius}
       Z`

  // Colours
  const litFill = isBWMode ? '#ffffff' : '#d9dde4'
  const unlitStroke = isBWMode ? '#ffffff' : 'silver'

  return (
    <div className="flight-stat moon-stat-column">
      <svg className="moon-glyph" width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
        <title>{phaseName}</title>
        {/* Unlit circle (background) */}
        <circle
          cx={centerX}
          cy={centerY}
          r={radius}
          fill="transparent"
          stroke={unlitStroke}
          strokeWidth="0.5"
        />
        {/* Lit portion */}
        <path
          d={litArcPath}
          fill={litFill}
        />
      </svg>
      <span className="flight-stat-value">{hours}h {mins}m</span>
    </div>
  )
}
