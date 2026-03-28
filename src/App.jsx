import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './App.css'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import tzlookup from 'tz-lookup'
import pointInPolygon from 'point-in-polygon-hao'
import { DateTime } from 'luxon'
import packageJson from '../package.json'
import ReactMarkdown from 'react-markdown'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { useNavigate, useParams } from 'react-router-dom'
import { latLonToVector3, getFlightScale, getViewportScale } from './utils/geoUtils'
import { calculateSolarDeclination, getSubsolarPoint, getSunAngle, isPointInDaylight } from './utils/solarUtils'
import { createAirportLabelTexture, createTransitionLabelTexture } from './utils/sceneUtils'
import { animateValue } from './utils/animationUtils'
import { lookupFlight } from './services/fr24'
import { interpolateTimestamp } from './utils/routeInterpolation'
import FlightInputPanel from './components/FlightInputPanel'
import ShareButton from './components/ShareButton'
import AnimationControls from './components/AnimationControls'
import { Analytics } from '@vercel/analytics/react'

const CATMULLROM_TENSION = 0.2

// ===== THEME COLOR CONSTANTS =====
// Single source of truth for background colors used in Three.js scene,
// document body, and meta theme-color. Mirror values in App.css :root / .bw-mode.
const BG_COLOR_DARK = '#2a2d31'   // tweak this to test color mode background
const BG_COLOR_BW   = '#f5f5f5'

function App() {
  const navigate = useNavigate()
  const params = useParams()

  // ===== STATE =====
  // Loading
  const [isLoading, setIsLoading] = useState(true)
  const [departureTime, setDepartureTime] = useState(new Date())
  
  // Airport Search & Selection
  const [departureCode, setDepartureCode] = useState('')
  const [arrivalCode, setArrivalCode] = useState('')
  const [airports, setAirports] = useState(null)
  const [airportsIcao, setAirportsIcao] = useState(null)
  const [airlines, setAirlines] = useState(null)
  const [departureAirport, setDepartureAirport] = useState(null)
  const [arrivalAirport, setArrivalAirport] = useState(null)
  const [searchEditing, setSearchEditing] = useState(0)
  const [pendingUrlFlight, setPendingUrlFlight] = useState(false)
  const [pendingCallsignStart, setPendingCallsignStart] = useState(false)
  
  // Flight Calculation & Animation
  const [flightPath, setFlightPath] = useState(null)
  const [flightResults, setFlightResults] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [animationProgress, setAnimationProgress] = useState(0)
  const [showFlightStats, setShowFlightStats] = useState(true)
  
  // Flight Search Mode
  const [searchMode, setSearchMode] = useState('route')  // 'route' | 'callsign'
  const [callsignInput, setCallsignInput] = useState('')
  const [callsignSearchResult, setCallsignSearchResult] = useState(null)
  const [callsignError, setCallsignError] = useState(null)
  const [isCallsignSearching, setIsCallsignSearching] = useState(false)

  // UI State
  const [showAirports, setShowAirports] = useState(true)
  const [showGraticule, setShowGraticule] = useState(true)
  const [, setShowPlaneIcon] = useState(true)
  const [showTimezones, setShowTimezones] = useState(false)
  const [showFirRegions, setShowFirRegions] = useState(false)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isPanelFading, setIsPanelFading] = useState(false) // Drives .fading class for mobile collapse/expand fade-then-switch pattern
  const [autoRotate, setAutoRotate] = useState(true)
  const [isBWMode, setIsBWMode] = useState(false)
  const [followPlaneMode, setFollowPlaneMode] = useState(false)
  const [showTwilightLines, setShowTwilightLines] = useState(false) 
  
  // Accordion/Info State
  const [expandedSection, setExpandedSection] = useState(null)
  const [aboutContent, setAboutContent] = useState('')
  const [dataContent, setDataContent] = useState('')
  const [isClosing, setIsClosing] = useState(false)

  // Mobile Detection
  // Compute initial mobile state synchronously so the scene effect can use it
  const isMobileInitial = typeof window !== 'undefined' && (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 768)
  )
  const [isMobile, setIsMobile] = useState(isMobileInitial)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [isMobileMenuClosing, setIsMobileMenuClosing] = useState(false)
  const [isMobileMenuAnimating, setIsMobileMenuAnimating] = useState(false) // Guards hamburger button against re-trigger during close animation
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false)

  // ===== REFS =====
  // Three.js Core
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const controlsRef = useRef(null)
  const tooltipRef = useRef(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const highlightedTimezoneRef = useRef(null)
  const lastMousePos = useRef(null)

  // Three.js Scene Objects - Visualization
  const flightLineRef = useRef(null)
  const progressTubeRef = useRef(null)
  const transitionLabelsRef = useRef([])
  const departureLabelRef = useRef(null)
  const arrivalLabelRef = useRef(null)
  const planeIconRef = useRef(null)
  const navLightsRef = useRef({ port: null, starboard: null })
  const twilightSphereRef = useRef(null)
  const glowRef = useRef(null)
  const twilightLinesRef = useRef({
    terminatorDay: null,
    terminatorNight: null,
    civilDay: null,
    civilNight: null,
    nauticalDay: null,
    nauticalNight: null,
    astronomicalDay: null,
    astronomicalNight: null
  })
 
  // Three.js Materials & Textures
  const earthMaterialRef = useRef(null)
  const oceanShaderUniformsRef = useRef(null)
  const oceanMaskTextureRef = useRef(null)
  const ambientLightRef = useRef(null)
  const planeTextureRef = useRef(null)
  const planeBWTextureRef = useRef(null)
  const bwColorsRef = useRef(null)
  
  // Animation & Flight Data
  const flightDataRef = useRef(null)
  const animationProgressRef = useRef(0)
  const hasFlightPathRef = useRef(false)
  const callsignControlPointsRef = useRef(null)
  const callsignArcLengthFractionsRef = useRef(null)
  
  // Feature Toggles (synced with state)
  const autoRotateRef = useRef(true)
  const showPlaneIconRef = useRef(true)
  const isBWModeRef = useRef(false)
  const followPlaneModeRef = useRef(false)
  const isPlayingRef = useRef(false)

  // Scaling
  const viewportScaleRef = useRef(getViewportScale(window.innerWidth))
  const targetBumpScaleRef = useRef(7)
  
  // External Data & Intervals
  const timezoneDataRef = useRef(null)
  const firDataRef = useRef(null)
  const highlightedFirRef = useRef(null)

  // Helper to get RGB color from CSS variable
  const getCSSColor = (varName, element = document.documentElement) => {
    const rgb = getComputedStyle(element)
      .getPropertyValue(varName)
      .trim()
      .match(/\d+/g)
    
    return {
      r: parseInt(rgb[0]) / 255,
      g: parseInt(rgb[1]) / 255,
      b: parseInt(rgb[2]) / 255
    }
  }

  // Inverse of latLonToVector3: convert a point on the sphere back to lat/lon
  const vector3ToLatLon = (v) => {
    const radius = v.length()
    const lat = 90 - Math.acos(v.y / radius) * (180 / Math.PI)
    const lon = Math.atan2(v.z, -v.x) * (180 / Math.PI) - 180
    return { lat, lon: ((lon + 540) % 360) - 180 }
  }

  // Calculate points along a twilight boundary with latitude-dependent width
  const calculateTwilightBoundary = (sunDirection, baseElevationAngle, currentTime) => {
    const points = []
    const numPoints = 360
    
    // Calculate solar declination
    const sunDeclination = calculateSolarDeclination(currentTime)
    
    // Subsolar point
    const subsolarLat = Math.asin(sunDirection.y)
    const subsolarLon = Math.atan2(sunDirection.z, -sunDirection.x)
    
    // Base approach: start with simple circle, then adjust radius based on latitude
    for (let i = 0; i <= numPoints; i++) {
      const bearing = (i / numPoints) * 2 * Math.PI
      
      // Start with base angular radius (for equator)
      const baseAngularRadius = (90 - baseElevationAngle) * Math.PI / 180
      
      // Calculate initial point
      let lat = Math.asin(
        Math.sin(subsolarLat) * Math.cos(baseAngularRadius) +
        Math.cos(subsolarLat) * Math.sin(baseAngularRadius) * Math.cos(bearing)
      )
      
      let lon = subsolarLon + Math.atan2(
        Math.sin(bearing) * Math.sin(baseAngularRadius) * Math.cos(subsolarLat),
        Math.cos(baseAngularRadius) - Math.sin(subsolarLat) * Math.sin(lat)
      )
      
      // Now adjust based on latitude effects (only for twilight lines, not terminator)
      if (baseElevationAngle !== 0) {
        const latDeg = lat * 180 / Math.PI
        const absLatitude = Math.abs(latDeg)
        
        // Calculate obliquity factor (from shader)
        const latitudeFactor = Math.cos(absLatitude * Math.PI / 180)
        const declinationDiff = Math.abs(latDeg - sunDeclination)
        const declinationFactor = 1.0 + (declinationDiff / 90.0) * 0.5
        const latitudeEffect = 1.0 + (1.4 - 1.0) * (1.0 - latitudeFactor)
        const obliquityFactor = latitudeEffect * declinationFactor
        
        // Apply obliquity factor with reduced strength (blend with base value)
        const blendFactor = 0.2  // Only apply 20% of the obliquity effect
        const effectiveObliquity = 1.0 + (obliquityFactor - 1.0) * blendFactor
        
        // Adjust the elevation angle based on obliquity
        const adjustedElevation = baseElevationAngle * effectiveObliquity
        
        // Recalculate with adjusted radius
        const adjustedAngularRadius = (90 - adjustedElevation) * Math.PI / 180
        
        lat = Math.asin(
          Math.sin(subsolarLat) * Math.cos(adjustedAngularRadius) +
          Math.cos(subsolarLat) * Math.sin(adjustedAngularRadius) * Math.cos(bearing)
        )
        
        lon = subsolarLon + Math.atan2(
          Math.sin(bearing) * Math.sin(adjustedAngularRadius) * Math.cos(subsolarLat),
          Math.cos(adjustedAngularRadius) - Math.sin(subsolarLat) * Math.sin(lat)
        )
      }
      
      // Convert to 3D coordinates
      const radius = 2.001
      const phi = Math.PI / 2 - lat
      const theta = lon
      
      const x = -radius * Math.sin(phi) * Math.cos(theta)
      const y = radius * Math.cos(phi)
      const z = radius * Math.sin(phi) * Math.sin(theta)
      
      points.push(new THREE.Vector3(x, y, z))
    }
    
    return points
  }

  // Update twilight boundary lines based on sun direction
  const updateTwilightLines = (sunDirection, currentTime) => {
    if (!twilightLinesRef.current.terminatorDay) return
    
    // Calculate boundaries for day side
    const terminatorPointsDay = calculateTwilightBoundary(sunDirection, 0, currentTime)
    const civilPointsDay = calculateTwilightBoundary(sunDirection, -6, currentTime)
    const nauticalPointsDay = calculateTwilightBoundary(sunDirection, -12, currentTime)
    const astronomicalPointsDay = calculateTwilightBoundary(sunDirection, -18, currentTime)
    
    // Calculate boundaries for night side
    const antisolarDirection = sunDirection.clone().multiplyScalar(-1)
    const terminatorPointsNight = calculateTwilightBoundary(antisolarDirection, 0, currentTime)
    const civilPointsNight = calculateTwilightBoundary(antisolarDirection, -6, currentTime)
    const nauticalPointsNight = calculateTwilightBoundary(antisolarDirection, -12, currentTime)
    const astronomicalPointsNight = calculateTwilightBoundary(antisolarDirection, -18, currentTime)
    
    // Helper to convert Vector3 array to flat position array for Line2
    const pointsToPositions = (points) => {
      const positions = []
      points.forEach(p => {
        positions.push(p.x, p.y, p.z)
      })
      return positions
    }
    
    // Update geometries - Line2 uses setPositions instead of setFromPoints
    if (terminatorPointsDay.length > 0) {
      twilightLinesRef.current.terminatorDay.geometry.setPositions(pointsToPositions(terminatorPointsDay))
      twilightLinesRef.current.terminatorNight.geometry.setPositions(pointsToPositions(terminatorPointsNight))
    }
    
    if (civilPointsDay.length > 0) {
      twilightLinesRef.current.civilDay.geometry.setPositions(pointsToPositions(civilPointsDay))
      twilightLinesRef.current.civilNight.geometry.setPositions(pointsToPositions(civilPointsNight))
      twilightLinesRef.current.civilDay.computeLineDistances()
      twilightLinesRef.current.civilNight.computeLineDistances()
    }

    if (nauticalPointsDay.length > 0) {
      twilightLinesRef.current.nauticalDay.geometry.setPositions(pointsToPositions(nauticalPointsDay))
      twilightLinesRef.current.nauticalNight.geometry.setPositions(pointsToPositions(nauticalPointsNight))
      twilightLinesRef.current.nauticalDay.computeLineDistances()
      twilightLinesRef.current.nauticalNight.computeLineDistances()
    }

    if (astronomicalPointsDay.length > 0) {
      twilightLinesRef.current.astronomicalDay.geometry.setPositions(pointsToPositions(astronomicalPointsDay))
      twilightLinesRef.current.astronomicalNight.geometry.setPositions(pointsToPositions(astronomicalPointsNight))
      twilightLinesRef.current.astronomicalDay.computeLineDistances()
      twilightLinesRef.current.astronomicalNight.computeLineDistances()
    }
    
  }

  // Read URL parameters and set up flight data
  useEffect(() => {
    const segment = params.segment1 || params.callsign
    if (!segment) return
    if (!airports || !airportsIcao) return

    // Disambiguate: if segment contains a hyphen and both parts are 3-letter codes, it's route mode
    const isRouteMode = segment.includes('-') && segment.split('-').length === 2
      && segment.split('-').every(part => part.length === 3)

    if (isRouteMode) {
      const [from, to] = segment.split('-')
      if (!airports[from] || !airports[to]) return
      if (!params.date || !params.time) return
      const dateTime = `${params.date}T${params.time.slice(0, 2)}:${params.time.slice(2, 4)}:00`
      const flightDateTime = new Date(dateTime)
      setDepartureCode(from)
      setDepartureAirport(airports[from])
      setArrivalCode(to)
      setArrivalAirport(airports[to])
      setDepartureTime(flightDateTime)
      setPendingUrlFlight(true)
    } else {
      // Callsign mode: segment is a flight number
      const flightNumber = segment.toUpperCase()
      setSearchMode('callsign')
      setCallsignInput(flightNumber)

      // If date/time provided, parse them
      if (params.date && params.time) {
        const dateTime = `${params.date}T${params.time.slice(0, 2)}:${params.time.slice(2, 4)}:00Z`
        setDepartureTime(new Date(dateTime))
      }

      // Auto-trigger lookup
      lookupFlight(flightNumber).then(result => {
        if (!result) {
          setCallsignError('Flight not found in the last 14 days')
          return
        }
        setCallsignSearchResult(result)

        // If no date/time in URL, use typical departure time
        if (!params.date || !params.time) {
          if (result.typicalDepartureTimeUtc) {
            const [hh, mm] = result.typicalDepartureTimeUtc.split(':').map(Number)
            const now = new Date()
            now.setUTCHours(hh, mm, 0, 0)
            setDepartureTime(now)
          }
        }

        setPendingCallsignStart(true)
      }).catch(() => {
        setCallsignError('Unable to search flights. Please try again.')
      })
    }
  }, [airports, airportsIcao])

  // Auto-calculate flight once URL state is ready
  useEffect(() => {
    if (!pendingUrlFlight) return
    if (!departureCode || !arrivalCode || !departureAirport || !arrivalAirport) return

    setPendingUrlFlight(false)
    calculateFlight()
  }, [pendingUrlFlight, departureCode, arrivalCode, departureAirport, arrivalAirport])

  // Auto-start callsign flight from URL deep-link
  useEffect(() => {
    if (!pendingCallsignStart) return
    if (!callsignSearchResult) return
    if (!airportsIcao) return
    setPendingCallsignStart(false)
    handleCallsignStart()
  }, [pendingCallsignStart, callsignSearchResult, airportsIcao])

  // Keep refs in sync with state
  useEffect(() => {
    followPlaneModeRef.current = followPlaneMode
  }, [followPlaneMode])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    autoRotateRef.current = autoRotate
  }, [autoRotate])

  // Mobile detection - run once on mount
  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const isSmallScreen = window.innerWidth <= 768
      
      setIsMobile(isMobileDevice || (isTouchDevice && isSmallScreen))

      if (isMobileDevice || (isTouchDevice && isSmallScreen)) {
        setFollowPlaneMode(true)
      }
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Load about content on mount (for mobile menu)
  useEffect(() => {
    fetch('/content/about.md')
      .then(res => res.text())
      .then(text => setAboutContent(text))
      .catch(err => console.error('Error loading about content:', err))
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return

      // Track texture loading
      let texturesLoaded = 0
      const totalTextures = 2
      
      const checkAllLoaded = () => {
        texturesLoaded++
        if (texturesLoaded >= totalTextures) {
          setTimeout(() => setIsLoading(false), 300)
        }
      }

    // Load airport data from local JSON (built from OurAirports)
    fetch('/airports.json')
    .then(res => res.json())
    .then(data => {
      const airportMap = {}
      data.forEach(a => {
        airportMap[a.iata] = {
          name: a.name,
          city: a.municipality,
          country: a.country,
          iso: a.iso,
          icao: a.icao,
          lat: a.lat,
          lon: a.lon,
          type: a.type,
          score: a.score,
        }
      })
      setAirports(airportMap)

      const airportIcaoMap = {}
      data.forEach(a => {
        if (a.icao) {
          airportIcaoMap[a.icao] = {
            name: a.name,
            city: a.municipality,
            country: a.country,
            iso: a.iso,
            iata: a.iata,
            icao: a.icao,
            lat: a.lat,
            lon: a.lon,
            type: a.type,
            score: a.score,
          }
        }
      })
      setAirportsIcao(airportIcaoMap)
    })
    .catch(err => console.error('Error loading airports:', err))

    // Load airline data from local JSON
    fetch('/airlines.json')
    .then(res => res.json())
    .then(data => {
      setAirlines(data)
    })
    .catch(err => console.error('Error loading airlines:', err))

    // 1. Create the scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BG_COLOR_DARK)
    sceneRef.current = scene  // Store scene reference

    // 2. Create the camera
    const camera = new THREE.PerspectiveCamera(
      75,  // field of view
      window.innerWidth / window.innerHeight,  // aspect ratio
      0.01,  // near clipping plane
      1000  // far clipping plane
    )
    camera.position.z = 3.5  // move camera back so we can see the sphere
    camera.userData.initialHeight = window.innerHeight
    cameraRef.current = camera 

    // 3. Create the renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true  // smooth edges
    })
    rendererRef.current = renderer
    const width = window.innerWidth;
    const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.localClippingEnabled = true  // Enable clipping

    // Add orbit controls for mouse/touch interaction
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.rotateSpeed = 0.4
    controlsRef.current = controls
    controls.minDistance = 3
    controls.maxDistance = 3.5
    controls.enableZoom = false
    controls.enablePan = false
    controls.autoRotate = true
    controls.autoRotateSpeed = -0.1
    
    // Touch controls
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    }

    // 4. Create a sphere (our Earth)
    const geometry = new THREE.SphereGeometry(2, 96, 96)

    // Load simplified Earth texture
    const earthTexture = new THREE.TextureLoader().load(
      isMobile ? '/earth-texture-mobile.png' : '/earth-texture.png',
      () => {
        earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        checkAllLoaded()
      },
      undefined,
      (error) => console.error('Error loading texture:', error)
    )

    const oceanMaskTexture = new THREE.TextureLoader().load(isMobile ? '/ocean-mask-mobile.png' : '/ocean-mask.png', () => {
      oceanMaskTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
      oceanMaskTextureRef.current = oceanMaskTexture
    })

    const bumpTexture = new THREE.TextureLoader().load(isMobile ? '/earth-bump-mobile.jpg' : '/earth-bump.jpg', () => {
      bumpTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    })

    const material = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.9,
      metalness: 0.0,
      bumpMap: bumpTexture,
      bumpScale: 7,
    })

    material.onBeforeCompile = (shader) => {
      shader.uniforms.oceanMask = { value: oceanMaskTexture }
      shader.uniforms.elevationMap = { value: bumpTexture }

      oceanShaderUniformsRef.current = shader.uniforms

      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `uniform sampler2D oceanMask;
uniform sampler2D elevationMap;
void main() {`
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float oceanFactor = texture2D(oceanMask, vMapUv).r;
float elevation = texture2D(elevationMap, vMapUv).r;

// Ocean tint
vec3 tinted = diffuseColor.rgb;
tinted.r -= 0.07;
tinted.g -= 0.04;
tinted.b += 0.02;
diffuseColor.rgb = mix(diffuseColor.rgb, tinted, oceanFactor);

// Land elevation color ramp: light green (low) to dark brown (high)
float landFactor = 1.0 - oceanFactor;
float elevGrey = mix(0.55, 1.0, elevation);
vec3 elevColor = vec3(elevGrey);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * elevColor, landFactor * 0.2);`
      )
    }

    const sphere = new THREE.Mesh(geometry, material)
    sphere.name = 'earth-sphere'
    scene.add(sphere)

    earthMaterialRef.current = material  // Store reference

    // Load plane icon
    const planeTexture = new THREE.TextureLoader().load('/plane-icon.svg', checkAllLoaded)
    const planeBWTexture = new THREE.TextureLoader().load('/plane-icon-bw.svg')
    planeTextureRef.current = planeTexture
    planeBWTextureRef.current = planeBWTexture

    // Create a plane mesh instead of sprite
    const planeSize = window.innerWidth <= 600 ? 0.06 : 0.04
    const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize)
    planeGeometry.rotateX(Math.PI / 2)  // Rotate geometry 90° around X axis
    planeGeometry.rotateY(Math.PI)
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: planeTexture,
      transparent: true,
      side: THREE.DoubleSide
    })
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.visible = false

    scene.add(planeMesh)
    planeIconRef.current = planeMesh

    // Create nav light glow texture (radial gradient on canvas)
    const navGlowCanvas = document.createElement('canvas')
    navGlowCanvas.width = 64
    navGlowCanvas.height = 64
    const ctx = navGlowCanvas.getContext('2d')
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.15, 'rgba(255,255,255,0.6)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.15)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    const navGlowTexture = new THREE.CanvasTexture(navGlowCanvas)

    const navLightSize = planeSize * 0.55
    const createNavLight = (color) => {
      const mat = new THREE.SpriteMaterial({
        map: navGlowTexture,
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(navLightSize, navLightSize, 1)
      sprite.visible = false
      scene.add(sprite)
      return sprite
    }
    navLightsRef.current.port = createNavLight(0xffffff)
    navLightsRef.current.starboard = createNavLight(0xffffff)

    // Add atmospheric glow
    const glowGeometry = new THREE.SphereGeometry(2.05, 64, 64)
    const glowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Vector3(3.0, 3.5, 5.0) }
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(glowColor, 1.0) * intensity;
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
    const atmosphereGlow = new THREE.Mesh(glowGeometry, glowMaterial)
    scene.add(atmosphereGlow)
    glowRef.current = atmosphereGlow

    // Add a marker at user location
    const dotGeometry = new THREE.SphereGeometry(0.01, 32, 32)
    const dotMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1,
      roughness: 0.8,
      metalness: 0.1
    })
    const dot = new THREE.Mesh(dotGeometry, dotMaterial)

    // Function to position dot based on lat/lon
    function positionDotAtLocation(lat, lon) {
      dot.position.copy(latLonToVector3(lat, lon, 2))
    }

    // Function to point camera at a location
    function centerCameraOnLocation(lat, lon) {
      camera.position.copy(latLonToVector3(lat, lon, 5))
      camera.lookAt(0, 0, 0)
      controls.update()
    }

    // Try to get user's location
    dot.visible = false
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude
          const userLon = position.coords.longitude
          positionDotAtLocation(userLat, userLon)
          dot.visible = true
          centerCameraOnLocation(userLat, userLon)
        },
        (_error) => {
          centerCameraOnLocation(45.464, 9.190)
        }
      )
    } else {
      centerCameraOnLocation(45.464, 9.190)
    }

    sphere.add(dot)

    // Calculate initial sun position
    const initialTime = new Date()

    // Get subsolar point (where sun is directly overhead)
    const subsolar = getSubsolarPoint(initialTime)
    const subsolarLongitude = subsolar.longitude
    const subsolarLatitude = subsolar.latitude

    // Convert subsolar point to 3D direction
    const phi = (90 - subsolarLatitude) * (Math.PI / 180)
    const theta = (subsolarLongitude + 180) * (Math.PI / 180)

    const sunDirection = new THREE.Vector3(
      -Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    )


    // Add ambient light (soft overall illumination)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3)
    scene.add(ambientLight)
    ambientLightRef.current = ambientLight

    // Add directional light positioned as the sun
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2)
    sunLight.position.copy(sunDirection.clone().multiplyScalar(10))
    scene.add(sunLight)

    // Create twilight gradient overlay with custom shader
    const twilightGeometry = new THREE.SphereGeometry(2.003, 128, 128)
    const twilightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: sunDirection.clone().normalize() },
        sunDeclination: { value: 0.0 },
        overlayIntensity: { value: 0.65 }
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        
        void main() {
          // Calculate world space normal
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform float sunDeclination;
        uniform float overlayIntensity;
        varying vec3 vWorldNormal;
        
        void main() {
          // Calculate angle between surface normal and sun direction in world space
          vec3 normal = normalize(vWorldNormal);
          float sunAngle = dot(normal, sunDirection);
          
          // Convert to degrees
          float angleDeg = acos(clamp(sunAngle, -1.0, 1.0)) * 180.0 / 3.14159;
          
          // Calculate latitude from the world normal
          float latitude = asin(clamp(normal.y, -1.0, 1.0)) * 180.0 / 3.14159;
          float absLatitude = abs(latitude);
          
          // Calculate twilight width based on latitude AND solar declination
          // The sun's path relative to horizon depends on both observer latitude and sun's declination
          
          // Base twilight width (astronomical: sun from 0° to 18° below horizon)
          float baseTwilightAngle = 18.0;
          
          // Calculate the angular speed of sunset/sunrise
          // This depends on the angle between the sun's path and the horizon
          // At equator during equinox: sun drops perpendicular (fast)
          // At poles or when sun path is oblique: sun drops at shallow angle (slow)
          
          // Latitude effect: higher latitude = more oblique sun path
          float latitudeFactor = cos(absLatitude * 3.14159 / 180.0);
          
          // Declination effect: when sun declination differs from latitude, path is more oblique
          float declinationDiff = abs(latitude - sunDeclination);
          float declinationFactor = 1.0 + (declinationDiff / 90.0) * 0.5;
          
          // Reduce latitude effect by using a smaller multiplier
          float latitudeEffect = mix(1.0, 1.4, 1.0 - latitudeFactor);
          float obliquityFactor = latitudeEffect * declinationFactor;
          
          // Calculate effective twilight width with reduced base angle
          float twilightWidth = (baseTwilightAngle * 0.7) * obliquityFactor;
          
          // Clamp to tighter, more reasonable values
          twilightWidth = clamp(twilightWidth, 12.0, 28.0);
          
          // Apply the twilight zone centered at 90°
          float transitionStart = 90.0 - twilightWidth * 0.5;
          float transitionEnd = 90.0 + twilightWidth * 0.5;
          
          float darkness = 0.0;
          
          if (angleDeg >= transitionEnd) {
            // Full night
            darkness = 1.0;
          } else if (angleDeg <= transitionStart) {
            // Full day
            darkness = 0.0;
          } else {
            // Smooth transition from day to night
            float t = (angleDeg - transitionStart) / (transitionEnd - transitionStart);
            darkness = smoothstep(0.0, 1.0, t);
            darkness = pow(darkness, 1.5);
          }
          
          // Add subtle dithering to reduce banding artifacts
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          dither = (dither - 0.5) * 0.01; // Very subtle noise

          // Output black with calculated opacity and dithering
          float finalDarkness = clamp(darkness * overlayIntensity + dither, 0.0, 1.0);
          gl_FragColor = vec4(0.0, 0.0, 0.0, finalDarkness);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false
    })

    const twilightSphere = new THREE.Mesh(twilightGeometry, twilightMaterial)
    scene.add(twilightSphere)
    twilightSphereRef.current = twilightSphere

    // Create twilight boundary lines - separate for day and night sides

    // Helper to create a Line2 with given material properties
    const createTwilightLine = (color, opacity, linewidth, dashed = false, dashSize = 0, gapSize = 0, depthWrite = true) => {
      const material = new LineMaterial({
        color: color,
        opacity: opacity,
        transparent: true,
        linewidth: linewidth,
        dashed: dashed,
        dashSize: dashSize,
        gapSize: gapSize,
        dashScale: 1,
        worldUnits: false,
        depthWrite: depthWrite
      })
      
      const geometry = new LineGeometry()
      const line = new Line2(geometry, material)
      line.visible = false
      line.renderOrder = 10
      return line
    }

    // Terminator lines (solid) - with depthWrite disabled
    const terminatorLineDay = createTwilightLine(0xd8e8f8, 0.6, 1, false, 0, 0, false)  // Last param = depthWrite false
    scene.add(terminatorLineDay)

    const terminatorLineNight = createTwilightLine(0xd8e8f8, 0.6, 1, false, 0, 0, false)  // Last param = depthWrite false
    scene.add(terminatorLineNight)

    // Civil twilight lines (dashed)
    const civilLineDay = createTwilightLine(0xb8d8f0, 0.4, 1, true, 0.025, 0.025)  // dashed
    scene.add(civilLineDay)

    const civilLineNight = createTwilightLine(0xb8d8f0, 0.4, 1, true, 0.025, 0.025)
    scene.add(civilLineNight)

    // Nautical twilight lines (dotted - small gaps)
    const nauticalLineDay = createTwilightLine(0x8ab8e0, 0.4, 2, true, 0.003, 0.03)  // dotted
    scene.add(nauticalLineDay)

    const nauticalLineNight = createTwilightLine(0x8ab8e0, 0.4, 2, true, 0.003, 0.03)
    scene.add(nauticalLineNight)

    // Astronomical twilight lines (dotted - large gaps)
    const astronomicalLineDay = createTwilightLine(0x6a9fd0, 0.4, 1.8, true, 0.005, 0.015)  // dotted
    scene.add(astronomicalLineDay)

    const astronomicalLineNight = createTwilightLine(0x6a9fd0, 0.4, 1.8, true, 0.005, 0.015)
    scene.add(astronomicalLineNight)

    twilightLinesRef.current = {
      terminatorDay: terminatorLineDay,
      terminatorNight: terminatorLineNight,
      civilDay: civilLineDay,
      civilNight: civilLineNight,
      nauticalDay: nauticalLineDay,
      nauticalNight: nauticalLineNight,
      astronomicalDay: astronomicalLineDay,
      astronomicalNight: astronomicalLineNight
    }

    // Store references for updating
    const sceneRefs = {
      sunLight,
      twilightMaterial
    }

    function updateSunPosition() {
      const currentTime = new Date()
      
      // Get subsolar point
      const subsolar = getSubsolarPoint(currentTime)
      const subsolarLongitude = subsolar.longitude
      const sunDeclination = subsolar.latitude

      // Convert subsolar point to 3D direction
      const phi = (90 - sunDeclination) * (Math.PI / 180)
      const theta = (subsolarLongitude + 180) * (Math.PI / 180)

      const sunDirection = new THREE.Vector3(
        -Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      )
      
      // Update light position
      sceneRefs.sunLight.position.copy(sunDirection.clone().multiplyScalar(10))
      
      // Update twilight shader
      sceneRefs.twilightMaterial.uniforms.sunDirection.value.copy(sunDirection.normalize())
      sceneRefs.twilightMaterial.uniforms.sunDeclination.value = sunDeclination

      // Update twilight boundary lines
      updateTwilightLines(sunDirection.normalize(), currentTime)
    }

    function updateSunPositionForTime(time) {
      // Get subsolar point for specific time
      const subsolar = getSubsolarPoint(time)
      const subsolarLongitude = subsolar.longitude
      const subsolarLatitude = subsolar.latitude
    
      // Convert subsolar point to 3D direction
      const phi = (90 - subsolarLatitude) * (Math.PI / 180)
      const theta = (subsolarLongitude + 180) * (Math.PI / 180)
    
      const sunDirection = new THREE.Vector3(
        -Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      )
      
      // Update light position
      sceneRefs.sunLight.position.copy(sunDirection.clone().multiplyScalar(10))
      
      // Update twilight shader
      sceneRefs.twilightMaterial.uniforms.sunDirection.value.copy(sunDirection.normalize())
      sceneRefs.twilightMaterial.uniforms.sunDeclination.value = subsolarLatitude

      // Update twilight boundary lines
      updateTwilightLines(sunDirection.normalize(), time)
    }

    // 5. Animation loop
    let lastFrameTime = 0
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    // Scratch objects for animation loop — reused every frame, never allocate inside animate()
    const _tangent = new THREE.Vector3()
    const _normal = new THREE.Vector3()
    const _right = new THREE.Vector3()
    const _up = new THREE.Vector3()
    const _surfaceOffset = new THREE.Vector3()
    const _forwardOffset = new THREE.Vector3()
    const _matrix = new THREE.Matrix4()
    const _planeNormal = new THREE.Vector3()
    const _south = new THREE.Vector3()
    const _east = new THREE.Vector3()
    const _actualSouth = new THREE.Vector3()
    const _tiltedNormal = new THREE.Vector3()
    const _currentNormal = new THREE.Vector3()
    const _targetNormal = new THREE.Vector3()
    const _axis = new THREE.Vector3()
    const _camTarget = new THREE.Vector3()
    const _navLightPos = new THREE.Vector3()

    function animate(currentTime) {
      requestAnimationFrame(animate)
      
      if (isMobileDevice) {
        const isActive = isPlayingRef.current || followPlaneModeRef.current
        const targetInterval = isActive ? 1000 / 60 : 1000 / 30
        
        if (currentTime - lastFrameTime < targetInterval) return
        lastFrameTime = currentTime
      }
      
      // Pulsate the dot brightness
      const time = Date.now() * 0.002
      const intensity = 0.5 + Math.sin(time) * 0.5
      dotMaterial.emissiveIntensity = intensity

      // Update sun position based on animation progress if flight is active
      if (flightDataRef.current && hasFlightPathRef.current) {
        const { departureTime, flightDurationMs } = flightDataRef.current
        const currentFlightTime = new Date(departureTime.getTime() + animationProgressRef.current * flightDurationMs)
        
        // Update sun position to animation time
        updateSunPositionForTime(currentFlightTime)
      } else {
        // Normal real-time mode when no flight is active
        updateSunPosition()
      }

      // Update flight path progress visualization
      if (hasFlightPathRef.current && flightLineRef.current && flightLineRef.current.userData.routeCurve) {
        const progress = animationProgressRef.current
        const curve = flightLineRef.current.userData.routeCurve

        // Reveal progress tube via drawRange
        if (progressTubeRef.current && progress > 0) {
          const geo = progressTubeRef.current.geometry
          const totalIndices = geo.index ? geo.index.count : geo.attributes.position.count
          progressTubeRef.current.geometry.setDrawRange(0, Math.floor(progress * totalIndices))
        } else if (progressTubeRef.current) {
          progressTubeRef.current.geometry.setDrawRange(0, 0)
        }

        // Update pre-created transition labels and rings visibility
        transitionLabelsRef.current.forEach(label => {
          const transitionT = label.userData.transitionT
          const ring = label.userData.ring

          if (transitionT <= progress) {
            label.visible = true
            const isCallsignMode = flightLineRef.current?.userData.isCallsignMode
            const point = isCallsignMode ? curve.getPointAt(transitionT) : curve.getPoint(transitionT)
            if (isCallsignMode) point.normalize().multiplyScalar(2.01)
            const eScale = flightLineRef.current?.userData.elementScale || 1.0
            const N = point.clone().normalize()
            const radialLift = N.multiplyScalar(0.03 * eScale)
            const B = label.userData.binormalDirection
            const lateralShift = B ? B.clone().multiplyScalar(0.04 * eScale) : new THREE.Vector3()
            label.position.copy(point).add(radialLift).add(lateralShift)

            const fadeProgress = (progress - transitionT) / 0.02
            label.material.opacity = Math.min(fadeProgress, 1)

            if (ring) {
              ring.visible = true
              ring.position.copy(point)
              const tangent = (isCallsignMode ? curve.getTangentAt(transitionT) : curve.getTangent(transitionT)).normalize()
              ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
              ring.material.opacity = Math.min(fadeProgress, 1)
            }
          } else {
            label.visible = false
            label.material.opacity = 0
            if (ring) {
              ring.visible = false
              ring.material.opacity = 0
            }
          }
        })
      }

      // Update plane icon position and rotation
      if (hasFlightPathRef.current && flightLineRef.current && planeIconRef.current) {
        const progress = animationProgressRef.current
        const curve = flightLineRef.current.userData.routeCurve
        
        if (curve && progress > 0 && progress < 1) {
          // Get current position
          const isCallsignMode = flightLineRef.current?.userData.isCallsignMode
          const position = isCallsignMode ? curve.getPointAt(progress) : curve.getPoint(progress)
          if (isCallsignMode) position.normalize().multiplyScalar(2.01)

          // Get tangent (direction of travel)
          _tangent.copy(isCallsignMode ? curve.getTangentAt(progress) : curve.getTangent(progress)).normalize()
          
          // Get normal (pointing away from Earth)
          _normal.copy(position).normalize()
          
          // Calculate right vector
          _right.crossVectors(_tangent, _normal).normalize()
          
          // Recalculate up to ensure orthogonal
          _up.crossVectors(_right, _tangent).normalize()
          
          // Position plane slightly above surface and ahead along the path
          const eScale = flightLineRef.current?.userData.elementScale || 1.0
          _surfaceOffset.copy(_normal).multiplyScalar(0.02 * eScale)
          _forwardOffset.copy(_tangent).multiplyScalar(0.035 * eScale)
          planeIconRef.current.position.copy(position).add(_surfaceOffset).add(_forwardOffset)

          // Camera follow mode
          if (followPlaneModeRef.current && isPlayingRef.current) {
            // Disable OrbitControls when following
            controls.enabled = false
            
            // Store original distance when first enabling follow mode
            if (!camera.userData.followModeDistance) {
              camera.userData.followModeDistance = camera.position.length()
            }
            
            // Use stored distance
            const targetDistance = camera.userData.followModeDistance
            
            // Get plane's normal (pointing away from Earth)
            _planeNormal.copy(position).normalize()
            
            // Create a tilt: shift camera 10° toward south, scaled for short flights
            const followScaleFactor = flightLineRef.current?.userData.scaleFactor || 1.0
            const tiltAngle = (10 * followScaleFactor) * Math.PI / 180
            
            // Calculate "south" direction (perpendicular to plane normal, toward negative latitude)
            _south.set(0, -1, 0)
            _east.crossVectors(_planeNormal, _south).normalize()
            _actualSouth.crossVectors(_east, _planeNormal).normalize()
            
            // Tilt the normal slightly toward south
            _tiltedNormal.copy(_planeNormal)
              .multiplyScalar(Math.cos(tiltAngle))
              .add(_actualSouth.multiplyScalar(Math.sin(tiltAngle)))
              .normalize()
            
            // Position camera at tilted angle
            _camTarget.copy(_tiltedNormal).multiplyScalar(targetDistance)
            
            // Smooth camera movement using spherical interpolation (slerp)
            _currentNormal.copy(camera.position).normalize()
            _targetNormal.copy(_camTarget).normalize()
            
            const angle = _currentNormal.angleTo(_targetNormal)
            
            if (angle < 0.0001) {
              // Already at target
              camera.position.copy(_camTarget)
            } else if (angle > Math.PI - 0.0001) {
              // Opposite positions - use linear interpolation
              camera.position.lerp(_camTarget, 0.05)
            } else {
              // Normal case - use spherical interpolation
              const lerpAmount = 0.05
              _axis.crossVectors(_currentNormal, _targetNormal).normalize()
              const quaternion = new THREE.Quaternion().setFromAxisAngle(_axis, angle * lerpAmount)
              _currentNormal.applyQuaternion(quaternion)
              
              // Apply the distance (keeps constant zoom)
              camera.position.copy(_currentNormal.multiplyScalar(targetDistance))
            }
            
            // Point camera at Earth center (0,0,0)
            camera.lookAt(0, 0, 0)
            
            // Update controls target to Earth center
            controls.target.set(0, 0, 0)
          } else {
            // Re-enable OrbitControls when not following or paused
            controls.enabled = true
            
            // Clear stored distance when disabling follow mode
            camera.userData.followModeDistance = null
            
            // Make sure controls target is at Earth center
            controls.target.set(0, 0, 0)
          }
          
          // Set orientation using basis vectors
          _matrix.makeBasis(_right, _up, _tangent.negate())
          planeIconRef.current.quaternion.setFromRotationMatrix(_matrix)
          
          // Fade out near the end
          let opacity = 1
          if (progress > 0.95) {
            opacity = (1 - progress) / 0.05  // Fade out in last 5%
          }
          
          planeIconRef.current.material.opacity = showPlaneIconRef.current ? opacity : 0
          planeIconRef.current.visible = showPlaneIconRef.current && opacity > 0

          // Nav lights — visible only in color mode during astronomical twilight/darkness
          const portLight = navLightsRef.current.port
          const starLight = navLightsRef.current.starboard
          if (portLight && starLight) {
            const showNav = showPlaneIconRef.current && !isBWModeRef.current && opacity > 0
            if (showNav && flightDataRef.current) {
              // Get lat/lon from plane 3D position
              const posLen = position.length()
              const lat = Math.asin(position.y / posLen) * 180 / Math.PI
              const lon = Math.atan2(position.z, -position.x) * 180 / Math.PI - 180
              const { departureTime: depTime, flightDurationMs: durMs } = flightDataRef.current
              const flightTime = new Date(depTime.getTime() + progress * durMs)
              const sunAngle = getSunAngle(lat, lon, flightTime)

              // Fade in during astronomical twilight (102-108°), full in darkness (>108°)
              const twilightFactor = Math.max(0, Math.min(1, (sunAngle - 102) / 6))

              if (twilightFactor > 0) {
                // Double flash then pause: two rapid flashes within a ~2s cycle
                const cycleMs = 2000
                const t = (currentTime % cycleMs) / cycleMs  // 0..1 over cycle
                // Flash 1: t 0.00-0.08, Flash 2: t 0.12-0.20, dark rest of cycle
                const flash1 = t < 0.08 ? Math.sin(t / 0.08 * Math.PI) : 0
                const flash2 = (t >= 0.12 && t < 0.20) ? Math.sin((t - 0.12) / 0.08 * Math.PI) : 0
                const navPulse = Math.max(flash1, flash2)
                const navOpacity = twilightFactor * (0.05 + 0.95 * navPulse) * opacity

                // Position on wingtips: half-span = planeSize * scale.x / 2
                const basePlaneSize = window.innerWidth <= 600 ? 0.06 : 0.04
                const wingOffset = basePlaneSize * (planeIconRef.current.scale.x || 1) * 0.5

                // Shift back from plane center to wing line (_tangent is negated at this point, so adding moves backward)
                const backOffset = 0.007 * (flightLineRef.current?.userData.elementScale || 1.0)
                _navLightPos.copy(planeIconRef.current.position).addScaledVector(_tangent, backOffset)
                portLight.position.copy(_navLightPos).addScaledVector(_right, -wingOffset)
                portLight.material.opacity = navOpacity
                portLight.visible = true

                starLight.position.copy(_navLightPos).addScaledVector(_right, wingOffset)
                starLight.material.opacity = navOpacity
                starLight.visible = true
              } else {
                portLight.visible = false
                starLight.visible = false
              }
            } else {
              portLight.visible = false
              starLight.visible = false
            }
          }

        } else {
          planeIconRef.current.visible = false
          if (navLightsRef.current.port) navLightsRef.current.port.visible = false
          if (navLightsRef.current.starboard) navLightsRef.current.starboard.visible = false
          // Re-enable OrbitControls when animation ends or is outside valid range
          if (controls) {
            controls.enabled = true
            camera.userData.followModeDistance = null
            controls.target.set(0, 0, 0)
          }
        }
      }

      // Keep location dot constant size, accounting for viewport width
      const currentDistance = camera.position.length()
      const baseDistance = 5  // Initial camera distance
      const dotScale = (currentDistance / baseDistance) * viewportScaleRef.current
      dot.scale.setScalar(dotScale)
      
      controls.autoRotate = autoRotateRef.current
      controls.update()
      renderer.render(scene, camera)
    }
    
    animate()

    // 6. Handle window resize
    function handleResize() {
      const width = window.innerWidth;
      const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      
      // On mobile, use the taller of current or initial height to prevent
      // globe shrinking when keyboard appears (canvas gets clipped instead)
      const initialHeight = camera.userData.initialHeight || height
      const renderHeight = Math.max(height, initialHeight)
      
      camera.aspect = width / renderHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, renderHeight);

      // Update viewport scale for 3D element sizing
      viewportScaleRef.current = getViewportScale(width)

      // Update Line2 materials resolution
      Object.values(twilightLinesRef.current).forEach(line => {
        if (line && line.material.resolution) {
          line.material.resolution.set(width, height)
        }
      })
    }
    window.addEventListener('resize', handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    // 7. Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize)
      }
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

    useEffect(() => {
      // Only clear if we have a flight path AND user is modifying airports
      if (!flightPath && !flightResults) return
      
      // Clear flight path when departure or arrival is being edited
      if (flightLineRef.current && sceneRef.current) {
        sceneRef.current.remove(flightLineRef.current)
        flightLineRef.current.traverse((child) => {
          if (child.geometry) child.geometry.dispose()
          if (child.material) child.material.dispose()
        })
        flightLineRef.current = null
      }
      
      // Clear labels
      if (departureLabelRef.current && sceneRef.current) {
        sceneRef.current.remove(departureLabelRef.current)
        departureLabelRef.current = null
      }
      if (arrivalLabelRef.current && sceneRef.current) {
        sceneRef.current.remove(arrivalLabelRef.current)
        arrivalLabelRef.current = null
      }
      
      // Reset flight path state
      setFlightPath(null)
      setFlightResults(null)
      setIsPanelCollapsed(false)
      setShowFlightStats(false)
      hasFlightPathRef.current = false
      transitionLabelsRef.current = []
      
      // Reset animation
      setAnimationProgress(0)
      animationProgressRef.current = 0
      setIsPlaying(false)

      // Reset OrbitControls to default range
      if (controlsRef.current) {
        controlsRef.current.minDistance = 3.0
        controlsRef.current.maxDistance = 3.5
      }
      
    }, [searchEditing])

    // Effect to draw flight path when flightPath state changes
    useEffect(() => {
      if (!flightPath || !sceneRef.current) return

      // Remove previous flight path if exists
      if (flightLineRef.current) {
        sceneRef.current.remove(flightLineRef.current)
        
        // Dispose all geometries and materials in the group
        flightLineRef.current.traverse((child) => {
          if (child.geometry) child.geometry.dispose()
          if (child.material) {
            if (child.material.map) child.material.map.dispose()
            child.material.dispose()
          }
        })
        
        flightLineRef.current = null
        progressTubeRef.current = null
        hasFlightPathRef.current = false
        transitionLabelsRef.current = []
      }

      const { departure, arrival } = flightPath

      // Create a group to hold everything
      const flightGroup = new THREE.Group()

      // Calculate route path: CatmullRom from FR24 control points (callsign mode)
      // or great circle SLERP (route mode)
      const numPoints = 100
      const radius = 2.01
      const callsignCPs = callsignControlPointsRef.current

      const points = []
      let angle = 0  // used only in SLERP segmentData below

      // callsignSourceCurve: the CatmullRom built directly from FR24 control points.
      // Used for arc-length parameterization (getPointAt) and arcLengthFractions.
      let callsignSourceCurve = null

      if (callsignCPs) {
        const cpVecs = callsignCPs.map(cp => latLonToVector3(cp.lat, cp.lon, radius))
        callsignSourceCurve = new THREE.CatmullRomCurve3(cpVecs, false, 'catmullrom', CATMULLROM_TENSION)
        for (let i = 0; i <= numPoints; i++) {
          const pt = callsignSourceCurve.getPointAt(i / numPoints)
          pt.normalize().multiplyScalar(radius)
          points.push(pt)
        }
      } else {
        // Get start and end points as 3D vectors
        const start = latLonToVector3(departure.lat, departure.lon, 1)
        const end = latLonToVector3(arrival.lat, arrival.lon, 1)

        // Calculate angle between vectors
        angle = start.angleTo(end)

        for (let i = 0; i <= numPoints; i++) {
          const fraction = i / numPoints
          const point = new THREE.Vector3()
          if (angle === 0) {
            point.copy(start)
          } else {
            const sinAngle = Math.sin(angle)
            const a = Math.sin((1 - fraction) * angle) / sinAngle
            const b = Math.sin(fraction * angle) / sinAngle
            point.x = a * start.x + b * end.x
            point.y = a * start.y + b * end.y
            point.z = a * start.z + b * end.z
          }
          point.normalize().multiplyScalar(radius)
          points.push(point)
        }
      }

      // Compute arc-length fractions for callsign mode (used for time interpolation)
      let arcLengthFractions = null
      if (callsignSourceCurve) {
        const lengths = callsignSourceCurve.getLengths(callsignCPs.length - 1)
        const total = lengths[lengths.length - 1]
        arcLengthFractions = lengths.map(l => l / total)
        callsignArcLengthFractionsRef.current = arcLengthFractions
      }

      // Calculate day/night segments along the route with sun angle
      if (!flightResults || !departureTime) {
        console.error('Missing flight data for color coding')
        return
      }

      const segmentData = []
      const lat1 = departure.lat * Math.PI / 180
      const lon1 = departure.lon * Math.PI / 180
      const lat2 = arrival.lat * Math.PI / 180
      const lon2 = arrival.lon * Math.PI / 180

      const flightDurationMs = flightDataRef.current?.flightDurationMs ?? ((flightResults.durationHours * 60 + flightResults.durationMins) * 60 * 1000)

      for (let i = 0; i < numPoints; i++) {
        const fraction = (i + 0.5) / numPoints

        // Calculate lat/lon at this point
        let lat, lon
        if (callsignCPs) {
          const pt = callsignSourceCurve.getPointAt(fraction)
          pt.normalize().multiplyScalar(radius)
          lat = Math.asin(pt.y / radius) * 180 / Math.PI
          lon = Math.atan2(pt.z, -pt.x) * 180 / Math.PI - 180
        } else {
          const a = Math.sin((1 - fraction) * angle) / Math.sin(angle)
          const b = Math.sin(fraction * angle) / Math.sin(angle)
          const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
          const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
          const z = a * Math.sin(lat1) + b * Math.sin(lat2)
          lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
          lon = Math.atan2(y, x) * 180 / Math.PI
        }

        // Calculate time at this point
        const timeAtPoint = callsignCPs
          ? interpolateTimestamp(callsignCPs, fraction, arcLengthFractions)
          : new Date(departureTime.getTime() + fraction * flightDurationMs)

        // Get sun angle (degrees from subsolar point)
        const sunAngle = getSunAngle(lat, lon, timeAtPoint)
        const inDaylight = sunAngle < 90

        segmentData.push({
          index: i,
          inDaylight,
          sunAngle  // Store the angle for gradient calculations
        })
      }

      // Pre-calculate colors for entire path - BOTH color and B&W versions
        const preCalculatedColorsColor = []
        const preCalculatedColorsBW = []
        const preCalculatedTransitions = []
        let lastWasDaylight = segmentData[0].sunAngle < 95

        for (let i = 0; i < segmentData.length; i++) {
          const segmentInfo = segmentData[i]
          const sunAngle = segmentInfo.sunAngle
          
          // Detect sunset vs sunrise
          let isSunset = false
          if (i > 0) {
            const earlierAngle = segmentData[Math.max(0, i - 1)].sunAngle
            isSunset = sunAngle > earlierAngle
          }
          
          // COLOR MODE colors
          // Bands anchored exactly to twilight line boundaries:
          //   90°  = terminator (sun on horizon)
          //   96°  = civil twilight end
          //  102°  = nautical twilight end
          //  108°  = astronomical twilight end / full night

          let r, g, b
          
          // Full daylight — sky blue at midday, warming toward pale white as sun descends
          if (sunAngle < 87) {
            // Full daylight — vivid sky blue holding right up to near the terminator
            const t = sunAngle / 87
            const tSlow = t * t
            r = 0.15 + tSlow * 0.80
            g = 0.50 + tSlow * 0.45
            b = 1.00 - tSlow * 0.55

          } else if (sunAngle < 91) {
            // Golden hour — tight 4° burst of warm colours around the terminator
            const t = (sunAngle - 87) / 4
            r = 1.00
            g = 0.95 - t * 0.55
            b = 0.45 - t * 0.45

          } else if (sunAngle < 96) {
            // CIVIL TWILIGHT — compressed, 91–96°
            const t = (sunAngle - 91) / 5
            if (isSunset) {
              r = 1.00 - t * 0.35
              g = 0.40 - t * 0.37
              b = 0.00 + t * 0.12
            } else {
              r = 1.00 - t * 0.10
              g = 0.40 - t * 0.30
              b = 0.00 + t * 0.25
            }

          } else if (sunAngle < 102) {
            // NAUTICAL TWILIGHT — 96–102°
            const t = (sunAngle - 96) / 6
            if (isSunset) {
              r = 0.65 - t * 0.50
              g = 0.03
              b = 0.12 + t * 0.20
            } else {
              r = 0.90 - t * 0.45
              g = 0.10 - t * 0.05
              b = 0.25 + t * 0.15
            }

          } else if (sunAngle < 108) {
            // ASTRONOMICAL TWILIGHT
            const t = (sunAngle - 102) / 6
            if (isSunset) {
              r = 0.15 - t * 0.12
              g = 0.03 - t * 0.01
              b = 0.32 - t * 0.15
            } else {
              r = 0.35 - t * 0.32
              g = 0.05 - t * 0.03
              b = 0.55 - t * 0.38
            }

          } else if (sunAngle < 114) {
            // DEEP NIGHT FADE
            const t = (sunAngle - 108) / 6
            r = 0.03 - t * 0.02
            g = 0.02
            b = 0.17 - t * 0.01  // very gentle fade, 0.17 → 0.16

          } else {
            // FULL NIGHT
            r = 0.01; g = 0.02; b = 0.16
          }

          preCalculatedColorsColor.push({ r, g, b })
          
          // B&W MODE colors
          const dayColor = { r: 1, g: 1, b: 1 }
          const nightColor = { r: 0, g: 0, b: 0 }
          
          if (sunAngle < 85) {
            r = dayColor.r
            g = dayColor.g
            b = dayColor.b
          } else if (sunAngle < 100) {
            const t = (sunAngle - 85) / 15
            const val = 1.0 - t
            r = val; g = val; b = val
          } else {
            r = nightColor.r
            g = nightColor.g
            b = nightColor.b
          }
          
          preCalculatedColorsBW.push({ r, g, b })
          
          // Detect daylight/darkness transitions (civil twilight boundary at ~96°)
          const isDaylight = sunAngle < 96  // 90° + 6° (civil twilight)

          if (i > 0 && isDaylight !== lastWasDaylight) {
            const t = i / segmentData.length
            let hours, minutes
            if (callsignCPs) {
              const depMs = new Date(callsignCPs[0].timestamp).getTime()
              const elapsedMs = interpolateTimestamp(callsignCPs, t, arcLengthFractions).getTime() - depMs
              hours = Math.floor(elapsedMs / 3600000)
              minutes = Math.floor((elapsedMs % 3600000) / 60000)
            } else {
              const elapsedMs = t * flightDurationMs
              hours = Math.floor(elapsedMs / 3600000)
              minutes = Math.floor((elapsedMs % 3600000) / 60000)
            }

            preCalculatedTransitions.push({
              index: i,
              t: t,
              time: `${hours}h ${minutes}m`,
              type: isDaylight ? 'sunrise' : 'sunset'
            })
            lastWasDaylight = isDaylight
          }
        }

        // Group consecutive segments by day/night
        const segments = []
        let currentSegment = {
          startIndex: 0,
          endIndex: 0,
          inDaylight: segmentData[0].inDaylight
        }

        for (let i = 1; i < segmentData.length; i++) {
          if (segmentData[i].inDaylight === currentSegment.inDaylight) {
            currentSegment.endIndex = i
          } else {
            currentSegment.endIndex = i
            segments.push(currentSegment)
            currentSegment = {
              startIndex: i,
              endIndex: i,
              inDaylight: segmentData[i].inDaylight
            }
          }
        }
        currentSegment.endIndex = numPoints - 1
        segments.push(currentSegment)

        // Distance-based and viewport scaling
        const { scaleFactor } = getFlightScale(flightResults.distance)
        const vScale = viewportScaleRef.current
        const elementScale = scaleFactor * vScale
        flightGroup.userData.routePoints = points
        flightGroup.userData.scaleFactor = scaleFactor
        flightGroup.userData.elementScale = elementScale
        flightGroup.userData.isCallsignMode = !!callsignCPs

        // Create the thin gray base path
        const thinTubeGeometry = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          points.length,
          0.002 * elementScale,
          12,
          false
        )
        const thinTubeMaterial = new THREE.MeshBasicMaterial({ 
          color: 0xffffff,
          transparent: true,
          opacity: 0.3
        })
        const thinTube = new THREE.Mesh(thinTubeGeometry, thinTubeMaterial)
        flightGroup.add(thinTube)

        // Store points for animated thick tube
        flightGroup.userData.routeCurve = new THREE.CatmullRomCurve3(points)
        flightGroup.userData.segmentData = segmentData
        flightGroup.userData.preCalculatedColorsColor = preCalculatedColorsColor
        flightGroup.userData.preCalculatedColorsBW = preCalculatedColorsBW
        flightGroup.userData.preCalculatedTransitions = preCalculatedTransitions

        // === Pre-build full progress tube (revealed via drawRange during animation) ===
        const fullProgressPoints = []
        const fullNumSamples = 800
        for (let i = 0; i <= fullNumSamples; i++) {
          const frac = i / fullNumSamples
          const fp = callsignCPs
            ? flightGroup.userData.routeCurve.getPointAt(frac)
            : flightGroup.userData.routeCurve.getPoint(frac)
          if (callsignCPs) fp.normalize().multiplyScalar(radius)
          fullProgressPoints.push(fp)
        }

        const fullTubeSegments = Math.min(fullProgressPoints.length * 2, 1600)
        const fullTubeGeo = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(fullProgressPoints),
          fullTubeSegments,
          0.006 * elementScale,
          12,
          false
        )

        // Build color arrays for both modes
        const totalVerts = fullTubeGeo.attributes.position.count
        const vertsPerSample = totalVerts / fullProgressPoints.length

        const fullColorArrColor = new Float32Array(totalVerts * 3)
        const fullColorArrBW = new Float32Array(totalVerts * 3)

        for (let i = 0; i < totalVerts; i++) {
          // Map vertex to its position along the path (0–1)
          const pathT = (i / vertsPerSample) / fullProgressPoints.length
          
          // Interpolate into the pre-calculated color array
          const exactIndex = pathT * preCalculatedColorsColor.length
          const lo = Math.min(Math.floor(exactIndex), preCalculatedColorsColor.length - 1)
          const hi = Math.min(lo + 1, preCalculatedColorsColor.length - 1)
          const frac = exactIndex - lo

          // Color mode
          const cLo = preCalculatedColorsColor[lo]
          const cHi = preCalculatedColorsColor[hi]
          fullColorArrColor[i * 3]     = cLo.r + (cHi.r - cLo.r) * frac
          fullColorArrColor[i * 3 + 1] = cLo.g + (cHi.g - cLo.g) * frac
          fullColorArrColor[i * 3 + 2] = cLo.b + (cHi.b - cLo.b) * frac

          // BW mode
          const bLo = preCalculatedColorsBW[lo]
          const bHi = preCalculatedColorsBW[hi]
          fullColorArrBW[i * 3]     = bLo.r + (bHi.r - bLo.r) * frac
          fullColorArrBW[i * 3 + 1] = bLo.g + (bHi.g - bLo.g) * frac
          fullColorArrBW[i * 3 + 2] = bLo.b + (bHi.b - bLo.b) * frac
        }

        // Apply initial color mode
        const initialColorArr = isBWModeRef.current ? fullColorArrBW : fullColorArrColor
        fullTubeGeo.setAttribute('color', new THREE.BufferAttribute(initialColorArr.slice(), 3))
        fullTubeGeo.setDrawRange(0, 0)

        const fullTubeMat = new THREE.MeshBasicMaterial({ vertexColors: true })
        const fullTube = new THREE.Mesh(fullTubeGeo, fullTubeMat)
        flightGroup.add(fullTube)
        progressTubeRef.current = fullTube

        // Store color arrays for BW switching
        flightGroup.userData.fullColorArrayColor = fullColorArrColor
        flightGroup.userData.fullColorArrayBW = fullColorArrBW

        // Pre-create transition labels and rings
        const transitionCurve = flightGroup.userData.routeCurve
        preCalculatedTransitions.forEach((trans, idx) => {
          // Compute right-hand side vector relative to direction of travel
          const tPoint = callsignCPs ? transitionCurve.getPointAt(trans.t) : transitionCurve.getPoint(trans.t)
          const tNormal = tPoint.clone().normalize()
          const tTangent = (callsignCPs ? transitionCurve.getTangentAt(trans.t) : transitionCurve.getTangent(trans.t)).normalize()
          const tBinormal = new THREE.Vector3().crossVectors(tTangent, tNormal).normalize()

          // Geographic heuristic: choose side based on path orientation
          const horizontalMag = Math.sqrt(tTangent.x * tTangent.x + tTangent.z * tTangent.z)
          const isNorthSouth = Math.abs(tTangent.y) > horizontalMag * 0.7

          if (isNorthSouth) {
            // Path runs mostly north-south: place label to the east side
            if (tBinormal.x < 0) tBinormal.negate()
          } else {
            // Path runs mostly east-west: place label to the north side
            if (tBinormal.y < 0) tBinormal.negate()
          }

          // If a previous transition is very close (<5% of curve), alternate sides
          if (idx > 0 && Math.abs(trans.t - preCalculatedTransitions[idx - 1].t) < 0.05) {
            tBinormal.negate()
          }

          // Create the ring (torus) at transition point
          const ringGeometry = new THREE.TorusGeometry(0.008 * elementScale, 0.002 * elementScale, 8, 32)
          const ringMaterial = new THREE.MeshBasicMaterial({
            color: isBWMode ? 0x1a1a1a : 0xffffff,
            transparent: true,
            opacity: 0
          })
          const ring = new THREE.Mesh(ringGeometry, ringMaterial)
          ring.visible = false
          ring.userData.transitionT = trans.t
          flightGroup.add(ring)

          // Create the label with icon
          createTransitionLabelTexture(trans.time, trans.type, isBWMode).then(texture => {
            sprite.material.map = texture
            sprite.material.needsUpdate = true
          })

          const texture = new THREE.CanvasTexture(document.createElement('canvas'))
          const material = new THREE.SpriteMaterial({
            map: texture,
            sizeAttenuation: true,
            depthTest: true
          })
          const sprite = new THREE.Sprite(material)
          sprite.scale.set((isMobile ? 0.22 : 0.17) * elementScale, (isMobile ? 0.08 : 0.06) * elementScale, 1)
          sprite.visible = false

          sprite.userData.transitionT = trans.t
          sprite.userData.transitionIndex = trans.index
          sprite.userData.timeText = trans.time
          sprite.userData.transitionType = trans.type  // 'sunrise' or 'sunset'
          sprite.userData.ring = ring  // Link ring to label
          sprite.userData.binormalDirection = tBinormal.clone()

          flightGroup.add(sprite)
          transitionLabelsRef.current.push(sprite)
        })    

        // Add airport markers (dots)
        const dotGeometry = new THREE.SphereGeometry(0.01 * elementScale, 16, 16)
        const dotMaterial = new THREE.MeshBasicMaterial({ color: isBWMode ? 0x1a1a1a : 0xe0e0e0 })
      
      const departureDot = new THREE.Mesh(dotGeometry, dotMaterial)
      departureDot.position.copy(latLonToVector3(departure.lat, departure.lon, 2.01))
      flightGroup.add(departureDot)
      
      const arrivalDot = new THREE.Mesh(dotGeometry, dotMaterial)
      arrivalDot.position.copy(latLonToVector3(arrival.lat, arrival.lon, 2.01))
      flightGroup.add(arrivalDot)

      // Add text labels using canvas textures
      const createTextLabel = async (text, iconSrc, isBW = false) => {
        const texture = await createAirportLabelTexture(text, iconSrc, isBW)
        const material = new THREE.SpriteMaterial({ 
          map: texture,
          sizeAttenuation: true,
        })
        const sprite = new THREE.Sprite(material)
        sprite.scale.set((isMobile ? 0.22 : 0.16) * elementScale, (isMobile ? 0.08 : 0.06) * elementScale, 1)
        return sprite
      }

      // Determine label placement direction based on flight path orientation
      // Labels go on the opposite side of the dot from the path direction
      let departureLabelSouth, arrivalLabelSouth

      if (callsignSourceCurve) {
        // In callsign mode, sample the actual curve direction near each airport
        // Use ~5% along the curve for departure direction, ~95% for arrival direction
        const depSample = callsignSourceCurve.getPointAt(0.05)
        const depStart = callsignSourceCurve.getPointAt(0)
        const depLatDiff = Math.asin(depSample.y / 2.01) - Math.asin(depStart.y / 2.01)

        const arrSample = callsignSourceCurve.getPointAt(0.95)
        const arrEnd = callsignSourceCurve.getPointAt(1)
        const arrLatDiff = Math.asin(arrEnd.y / 2.01) - Math.asin(arrSample.y / 2.01)

        // For departure: if path heads north, place label south (and vice versa)
        const depLonDiff = Math.atan2(depSample.x, depSample.z) - Math.atan2(depStart.x, depStart.z)
        const isDepEastWest = Math.abs(depLatDiff) < Math.abs(depLonDiff) * 0.3
        departureLabelSouth = isDepEastWest || depLatDiff > 0

        // For arrival: if path arrives from south (heading north), place label south
        const arrLonDiff = Math.atan2(arrEnd.x, arrEnd.z) - Math.atan2(arrSample.x, arrSample.z)
        const isArrEastWest = Math.abs(arrLatDiff) < Math.abs(arrLonDiff) * 0.3
        arrivalLabelSouth = isArrEastWest || arrLatDiff < 0
      } else {
        // Route mode: use straight-line bearing (existing logic)
        const latDiff = arrival.lat - departure.lat
        const isEastWest = Math.abs(latDiff) < Math.abs(arrival.lon - departure.lon) * 0.3
        departureLabelSouth = isEastWest || latDiff > 0
        arrivalLabelSouth = isEastWest || latDiff < 0
      }

      // Create labels with offset — positioned away from the flight path
      const createLabelWithOffset = async (code, lat, lon, iconSrc, placeSouth) => {
        const label = await createTextLabel(code, iconSrc, isBWModeRef.current)
        const basePos = latLonToVector3(lat, lon, 2.05)
        const offsetLat = placeSouth ? lat - 0.5 : lat + 0.5
        const offsetPos = latLonToVector3(offsetLat, lon, 2.05)
        const offsetDistance = placeSouth ? 0.075 : 0.06
        const offset = offsetPos.clone().sub(basePos).normalize().multiplyScalar(offsetDistance * elementScale)
        label.position.copy(basePos.add(offset))
        return label
      }

        const createLabels = async () => {
          // Delay to ensure isBWMode state is current after toggle
          // (prevents race condition with useEffect execution order)
          await new Promise(resolve => setTimeout(resolve, 0))
          
          const depIcon = isBWMode ? '/departure-icon-bw.svg' : '/departure-icon.svg'
          const arrIcon = isBWMode ? '/arrival-icon-bw.svg' : '/arrival-icon.svg'
                
        const departureLabel = await createLabelWithOffset(departureCode, departure.lat, departure.lon, depIcon, departureLabelSouth)
        departureLabel.userData.code = departureCode
        departureLabel.userData.lat = departure.lat
        departureLabel.userData.lon = departure.lon
        departureLabel.userData.type = 'departure'
        flightGroup.add(departureLabel)
        departureLabelRef.current = departureLabel

        const arrivalLabel = await createLabelWithOffset(arrivalCode, arrival.lat, arrival.lon, arrIcon, arrivalLabelSouth)
        arrivalLabel.userData.code = arrivalCode
        arrivalLabel.userData.lat = arrival.lat
        arrivalLabel.userData.lon = arrival.lon
        arrivalLabel.userData.type = 'arrival'
        flightGroup.add(arrivalLabel)
        arrivalLabelRef.current = arrivalLabel
        
        sceneRef.current.add(flightGroup)
        flightLineRef.current = flightGroup
        hasFlightPathRef.current = true
      }

      createLabels()

      }, [flightPath, flightResults, departureTime, departureCode, arrivalCode])

    // Effect to show/hide all airports
    useEffect(() => {
      if (!sceneRef.current || !airports) return
      
      // Remove existing airport dots with fade out
      const existingDots = sceneRef.current.getObjectByName('airportDots')
      if (existingDots) {
        const material = existingDots.material
        animateValue(material.opacity, 0, (v) => {
          material.opacity = v
        }, () => {
          sceneRef.current.remove(existingDots)
          existingDots.geometry.dispose()
          material.dispose()
        })
      }
      
      if (!showAirports) return
      
      // Create points for all airports
      const positions = []
      const colors = []
      const airportList = Object.values(airports)

      airportList.forEach(airport => {
        const pos = latLonToVector3(airport.lat, airport.lon, 2.005)
        positions.push(pos.x, pos.y, pos.z)
        const bright = airport.type === 'large'
        const c = isBWMode ? 0 : (bright ? 1 : 0.55)
        colors.push(c, c, c)
      })

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      
      // Create circular texture for round dots
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const ctx = canvas.getContext('2d')
      ctx.beginPath()
      ctx.arc(16, 16, 14, 0, Math.PI * 2)
      ctx.fillStyle = 'white'
      ctx.fill()
      const circleTexture = new THREE.CanvasTexture(canvas)

      const material = new THREE.PointsMaterial({
        vertexColors: true,
        size: isBWMode ? 2.5 : 2.3,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,  // Start invisible
        map: circleTexture,
        alphaMap: circleTexture,
        alphaTest: 0.5
      })

      const points = new THREE.Points(geometry, material)
      points.name = 'airportDots'
      sceneRef.current.add(points)

      // Fade in animation
      animateValue(0, 0.8, (v) => {
        material.opacity = v
      })
      
    }, [showAirports, airports, isBWMode])

    // Effect to show/hide graticule
    useEffect(() => {
      if (!sceneRef.current) return
      
      // Remove existing graticule if exists
      const existingGraticule = sceneRef.current.getObjectByName('graticule')
      if (existingGraticule) {
        animateValue(0.2, 0, (v) => {
          existingGraticule.traverse((child) => {
            if (child.material) child.material.opacity = v
          })
        }, () => {
          sceneRef.current.remove(existingGraticule)
          existingGraticule.traverse((child) => {
            if (child.geometry) child.geometry.dispose()
            if (child.material) child.material.dispose()
          })
        })
      }
      
      if (!showGraticule) return
      
      // Load and render graticule
      fetch('/graticule-10.geojson')
        .then(res => res.json())
        .then(data => {
          const graticuleGroup = new THREE.Group()
          graticuleGroup.name = 'graticule'   
          
          // Process each feature (line)
          data.features.forEach(feature => {
            if (feature.geometry.type === 'LineString') {
              const coords = feature.geometry.coordinates
              const points = coords.map(coord => 
                latLonToVector3(coord[1], coord[0], 2.004)
              )
              
              const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
              const lineMaterial = new THREE.LineBasicMaterial({
                color: isBWModeRef.current ? 0x0f0f0f : 0xffffff,
                transparent: true,
                opacity: 0, // Start invisible for fade-in
                depthTest: true,
                depthWrite: false
              })

              const line = new THREE.Line(lineGeometry, lineMaterial)
              graticuleGroup.add(line)
            } else if (feature.geometry.type === 'MultiLineString') {
              feature.geometry.coordinates.forEach(lineCoords => {
                const points = lineCoords.map(coord =>
                  latLonToVector3(coord[1], coord[0], 2.004)
                )

                const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
                const lineMaterial = new THREE.LineBasicMaterial({
                  color: isBWModeRef.current ? 0x0f0f0f : 0xffffff,
                  transparent: true,
                  opacity: 0, // Start invisible for fade-in
                  depthTest: true,
                  depthWrite: false
                })
                
                const line = new THREE.Line(lineGeometry, lineMaterial)
                graticuleGroup.add(line)
              })
            }
          })
          
          sceneRef.current.add(graticuleGroup)
          
          // Fade in
          animateValue(0, 0.2, (v) => {
            graticuleGroup.traverse((child) => {
              if (child.material) child.material.opacity = v
            })
          })

        })
        .catch(err => console.error('Error loading graticule:', err))
      
    }, [showGraticule])

    // Effect to show/hide timezone boundaries
    useEffect(() => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none'
      if (!sceneRef.current) return
      
      // Remove existing timezones if exists
      const existingTimezones = sceneRef.current.getObjectByName('timezone-boundaries')
      if (existingTimezones) {
        animateValue(0.3, 0, (v) => {
          existingTimezones.traverse((child) => {
            if (child.material) child.material.opacity = v
          })
        }, () => {
          sceneRef.current.remove(existingTimezones)
          existingTimezones.traverse((child) => {
            if (child.geometry) child.geometry.dispose()
            if (child.material) child.material.dispose()
          })
        })
      }
      
      if (!showTimezones) return
      
      // Load and render timezone boundaries
      fetch('/timezones.geojson')
        .then(res => res.json())
        .then(data => {
          timezoneDataRef.current = data

          const timezoneGroup = new THREE.Group()
          timezoneGroup.name = 'timezone-boundaries'
          
          // Process each feature (timezone boundary)
          data.features.forEach((feature, featureIndex) => {
            if (feature.geometry.type === 'Polygon') {
              feature.geometry.coordinates.forEach(ring => {
                const points = ring.map(coord =>
                  latLonToVector3(coord[1], coord[0], 2.005)
                )

                const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
                const lineMaterial = new THREE.LineBasicMaterial({
                  color: isBWMode ? 0x0f0f0f : 0xffffff,  // Check current BW mode state
                  transparent: true,
                  opacity: 0
                })

                const line = new THREE.Line(lineGeometry, lineMaterial)
                line.userData.featureIndex = featureIndex
                timezoneGroup.add(line)
              })
            } else if (feature.geometry.type === 'MultiPolygon') {
              feature.geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => {
                  const points = ring.map(coord =>
                    latLonToVector3(coord[1], coord[0], 2.005)
                  )

                  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
                  const lineMaterial = new THREE.LineBasicMaterial({
                    color: isBWMode ? 0x0f0f0f : 0xffffff,  // Check current BW mode state
                    transparent: true,
                    opacity: 0
                  })

                  const line = new THREE.Line(lineGeometry, lineMaterial)
                  line.userData.featureIndex = featureIndex
                  timezoneGroup.add(line)
                })
              })
            }
          })

          // International Date Line
          const dateLinePoints = []
          for (let lat = -90; lat <= 90; lat += 1) {
            const phi = (90 - lat) * (Math.PI / 180)
            const theta = (180 + 180) * (Math.PI / 180)
            const radius = 2.006
            
            dateLinePoints.push(new THREE.Vector3(
              -radius * Math.sin(phi) * Math.cos(theta),
              radius * Math.cos(phi),
              radius * Math.sin(phi) * Math.sin(theta)
            ))
          }

          const dateLineGeometry = new THREE.BufferGeometry().setFromPoints(dateLinePoints)
          const dateLineMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff, 
            transparent: true,
            opacity: 0.8
          })

          const dateLine = new THREE.Line(dateLineGeometry, dateLineMaterial)
          dateLine.userData.isDateLine = true
          timezoneGroup.add(dateLine)

          // Create label as a curved mesh that follows the sphere
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          canvas.width = 512
          canvas.height = 128

          context.fillStyle = isBWMode ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)'
          context.font = '42px system-ui'
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText('International Date Line', canvas.width / 2, canvas.height / 2)

          const texture = new THREE.CanvasTexture(canvas)

          // Use a curved plane geometry that follows the sphere
          const labelGeometry = new THREE.PlaneGeometry(0.4, 0.085, 32, 1)

          // Curve the geometry to match Earth's surface
          const positions = labelGeometry.attributes.position
          for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i)
            
            // Bend along the x-axis to follow meridian curvature
            const bendRadius = 2.008
            const angle = x / bendRadius
            
            positions.setX(i, bendRadius * Math.sin(angle))
            positions.setZ(i, -bendRadius * (1 - Math.cos(angle)))
          }
          positions.needsUpdate = true
          labelGeometry.computeVertexNormals()

          const labelMaterial = new THREE.MeshBasicMaterial({ 
            map: texture,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthTest: true
          })

          const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial)

          // Position on sphere at equator, slightly east of 180° longitude
          const labelLat = 0
          const labelLon = 179  // Shifted 1° west of the date line
          const phi = (90 - labelLat) * (Math.PI / 180)
          const theta = (labelLon + 180) * (Math.PI / 180)
          const radius = 2.008  // Closer to surface: was 2.05

          labelMesh.position.set(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
          )

          // Orient tangent to sphere surface
          const normal = new THREE.Vector3(
            -Math.sin(phi) * Math.cos(theta),
            Math.cos(phi),
            Math.sin(phi) * Math.sin(theta)
          )
          labelMesh.lookAt(labelMesh.position.clone().add(normal))
          labelMesh.rotateZ(Math.PI / 2) // Make text vertical

          labelMesh.userData.isDateLineLabel = true
          timezoneGroup.add(labelMesh)
          
          sceneRef.current.add(timezoneGroup)
          
          // Fade in
          animateValue(0, 0.3, (v) => {
            timezoneGroup.traverse((child) => {
              if (child.material) {
                if (child.userData.isDateLine || child.isSprite || child.userData.isDateLineLabel) {
                  child.material.opacity = Math.min(child.material.opacity, 0.9)
                } else {
                  child.material.opacity = v
                }
              }
            })
          })
          
        })
        .catch(err => console.error('Error loading timezone boundaries:', err))
      
    }, [showTimezones])

    // Effect to show/hide FIR region boundaries
    useEffect(() => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none'
      if (!sceneRef.current) return

      // Remove existing FIR boundaries if exists
      const existingFir = sceneRef.current.getObjectByName('fir-boundaries')
      if (existingFir) {
        animateValue(0.3, 0, (v) => {
          existingFir.traverse((child) => {
            if (child.material) child.material.opacity = v
          })
        }, () => {
          sceneRef.current.remove(existingFir)
          existingFir.traverse((child) => {
            if (child.geometry) child.geometry.dispose()
            if (child.material) child.material.dispose()
          })
        })
      }

      if (!showFirRegions) return

      fetch('/fir-regions.geojson')
        .then(res => res.json())
        .then(data => {
          firDataRef.current = data

          const firGroup = new THREE.Group()
          firGroup.name = 'fir-boundaries'

          // Subdivide a ring so that no segment spans more than maxDeg degrees,
          // interpolating along great-circle arcs to keep lines on the sphere.
          const subdivideRing = (ring, maxDeg = 2) => {
            const out = []
            for (let i = 0; i < ring.length; i++) {
              const [lon1, lat1] = ring[i]
              out.push(ring[i])
              if (i < ring.length - 1) {
                const [lon2, lat2] = ring[i + 1]
                const dLat = Math.abs(lat2 - lat1)
                const dLon = Math.abs(lon2 - lon1)
                const dist = Math.max(dLat, dLon)
                if (dist > maxDeg) {
                  const steps = Math.ceil(dist / maxDeg)
                  for (let s = 1; s < steps; s++) {
                    const t = s / steps
                    out.push([lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t])
                  }
                }
              }
            }
            return out
          }

          // Build map of FIR_NAMEs that have twin features on both sides of the date line
          // Store the overlapping lat range so we only suppress the shared seam portion
          const dateLineSplitLatRange = {}  // name -> { east: [minLat, maxLat], west: [minLat, maxLat] }
          data.features.forEach(f => {
            const name = f.properties.FIR_NAME
            if (!name) return
            for (const poly of f.geometry.coordinates) {
              const ring = poly[0]
              // Find points near the date line and their lat range
              const dlPoints = ring.filter(c => Math.abs(Math.abs(c[0]) - 180) < 1)
              if (dlPoints.length === 0) continue
              const dlLats = dlPoints.map(c => c[1])
              const minLat = Math.min(...dlLats)
              const maxLat = Math.max(...dlLats)
              const lons = ring.map(c => c[0])
              const side = lons.some(l => l > 170) && !lons.some(l => l < -170) ? 'east'
                         : lons.some(l => l < -170) && !lons.some(l => l > 170) ? 'west' : null
              if (!side) continue
              if (!dateLineSplitLatRange[name]) dateLineSplitLatRange[name] = {}
              dateLineSplitLatRange[name][side] = [minLat, maxLat]
            }
          })
          // Compute the overlapping lat range for each split name
          const dateLineOverlap = {}  // name -> [minLat, maxLat] of overlap
          for (const [name, sides] of Object.entries(dateLineSplitLatRange)) {
            if (sides.east && sides.west) {
              const overlapMin = Math.max(sides.east[0], sides.west[0])
              const overlapMax = Math.min(sides.east[1], sides.west[1])
              if (overlapMin < overlapMax) {
                // Expand by a small margin to cover tiny coordinate mismatches between twins
                dateLineOverlap[name] = [overlapMin - 1, overlapMax + 1]
              }
            }
          }

          const buildRingLine = (ring, featureIndex, firKey, overlapRange) => {
            const subdividedRing = subdivideRing(ring)

            // Split into segments, breaking where both endpoints are on the date line
            // Only suppress within the overlapping lat range of twin features
            const isDateLineLon = (lon) => Math.abs(Math.abs(lon) - 180) < 0.5
            const isInOverlap = (lat) => overlapRange && lat >= overlapRange[0] && lat <= overlapRange[1]

            const segments = []
            let currentSegment = []

            for (let i = 0; i < subdividedRing.length; i++) {
              const coord = subdividedRing[i]
              const prevCoord = i > 0 ? subdividedRing[i - 1] : null

              if (prevCoord && isDateLineLon(coord[0]) && isDateLineLon(prevCoord[0]) && isInOverlap(coord[1]) && isInOverlap(prevCoord[1])) {
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
              line.userData.firKey = firKey
              firGroup.add(line)
            }
          }

          data.features.forEach((feature, featureIndex) => {
            const firKey = `${feature.properties.ICAO_CODE}:${feature.properties.FIR_NAME}`
            const overlapRange = dateLineOverlap[feature.properties.FIR_NAME] || null
            if (feature.geometry.type === 'Polygon') {
              feature.geometry.coordinates.forEach(ring => buildRingLine(ring, featureIndex, firKey, overlapRange))
            } else if (feature.geometry.type === 'MultiPolygon') {
              feature.geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => buildRingLine(ring, featureIndex, firKey, overlapRange))
              })
            }
          })

          sceneRef.current.add(firGroup)

          // Fade in
          animateValue(0, 0.3, (v) => {
            firGroup.traverse((child) => {
              if (child.material) {
                child.material.opacity = v
              }
            })
          })

        })
        .catch(err => console.error('Error loading FIR boundaries:', err))

    }, [showFirRegions])

    // Tooltip: show FIR name on hover when FIR boundaries are visible
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || isMobile) return

      const resetHighlight = () => {
        highlightedFirRef.current = null
        const firGroup = sceneRef.current?.getObjectByName('fir-boundaries')
        if (firGroup) {
          firGroup.traverse((child) => {
            if (child.material && child.userData.featureIndex !== undefined) {
              child.material.opacity = 0.3
              child.material.color.setHex(isBWMode ? 0x0f0f0f : 0xffffff)
            }
          })
        }
      }

      const handleMouseMove = (e) => {
        if (!showFirRegions || !tooltipRef.current || !cameraRef.current || !sceneRef.current) {
          if (tooltipRef.current) tooltipRef.current.style.display = 'none'
          return
        }

        const rect = canvas.getBoundingClientRect()
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)

        const earthMesh = sceneRef.current.getObjectByName('earth-sphere')
        if (!earthMesh) {
          tooltipRef.current.style.display = 'none'
          return
        }

        const intersects = raycasterRef.current.intersectObject(earthMesh)

        if (intersects.length > 0) {
          const point = intersects[0].point
          const { lat, lon } = vector3ToLatLon(point)

          // Throttle point-in-polygon search to when mouse moves > 3px
          const dx = e.clientX - (lastMousePos.current?.x || 0)
          const dy = e.clientY - (lastMousePos.current?.y || 0)
          if (dx * dx + dy * dy >= 9) {
            lastMousePos.current = { x: e.clientX, y: e.clientY }

            let matchedFeatureIndex = null
            const firData = firDataRef.current
            if (firData) {
              for (let i = 0; i < firData.features.length; i++) {
                const feature = firData.features[i]
                const geom = feature.geometry
                let polygons = []

                if (geom.type === 'Polygon') {
                  polygons = [geom.coordinates]
                } else if (geom.type === 'MultiPolygon') {
                  polygons = geom.coordinates
                }

                for (const polygon of polygons) {
                  if (pointInPolygon([lon, lat], polygon)) {
                    matchedFeatureIndex = i
                    break
                  }
                }
                if (matchedFeatureIndex !== null) break
              }

              // If point-in-polygon missed (edge/gap), keep previous match
              if (matchedFeatureIndex === null) {
                matchedFeatureIndex = highlightedFirRef.current
              }
            }

            if (matchedFeatureIndex !== null) {
              const feature = firData.features[matchedFeatureIndex]
              const rawName = feature.properties.FIR_NAME
              const firName = rawName ? rawName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null
              const icaoCode = feature.properties.ICAO_CODE

              if (firName) {
                tooltipRef.current.textContent = `${firName} · ${icaoCode}`
              } else {
                tooltipRef.current.textContent = 'Unknown FIR'
              }
              tooltipRef.current.style.display = 'block'

              if (matchedFeatureIndex !== highlightedFirRef.current) {
                highlightedFirRef.current = matchedFeatureIndex
                const matchedFirKey = `${icaoCode}:${rawName}`
                const firGroup = sceneRef.current.getObjectByName('fir-boundaries')
                if (firGroup) {
                  firGroup.traverse((child) => {
                    if (child.material && child.userData.featureIndex !== undefined) {
                      if (child.userData.firKey === matchedFirKey) {
                        child.material.opacity = 1.0
                        child.material.color.setHex(isBWMode ? 0x000000 : 0xffffff)
                      } else {
                        child.material.opacity = 0.1
                        child.material.color.setHex(isBWMode ? 0x0f0f0f : 0xffffff)
                      }
                    }
                  })
                }
              }
            }
          }

          // Keep tooltip position updated while over the Earth
          tooltipRef.current.style.left = `${e.clientX + 16}px`
          tooltipRef.current.style.top = `${e.clientY + 16}px`
        } else {
          tooltipRef.current.style.display = 'none'
          resetHighlight()
        }
      }

      const handleMouseLeave = () => {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none'
        resetHighlight()
      }

      canvas.addEventListener('mousemove', handleMouseMove)
      canvas.addEventListener('mouseleave', handleMouseLeave)

      return () => {
        canvas.removeEventListener('mousemove', handleMouseMove)
        canvas.removeEventListener('mouseleave', handleMouseLeave)
      }
    }, [showFirRegions, isMobile, isBWMode])

    // Tooltip: show IANA timezone on hover when timezone boundaries are visible
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || isMobile) return

      const resetHighlight = () => {
        highlightedTimezoneRef.current = null
        const tzGroup = sceneRef.current?.getObjectByName('timezone-boundaries')
        if (tzGroup) {
          tzGroup.traverse((child) => {
            if (child.material && child.userData.featureIndex !== undefined) {
              child.material.opacity = 0.3
              child.material.color.setHex(isBWMode ? 0x0f0f0f : 0xffffff)
            }
          })
        }
      }

      const handleMouseMove = (e) => {
        if (!showTimezones || !tooltipRef.current || !cameraRef.current || !sceneRef.current) {
          if (tooltipRef.current && !showFirRegions) tooltipRef.current.style.display = 'none'
          return
        }

        const rect = canvas.getBoundingClientRect()
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)

        const earthMesh = sceneRef.current.getObjectByName('earth-sphere')
        if (!earthMesh) {
          tooltipRef.current.style.display = 'none'
          return
        }

        const intersects = raycasterRef.current.intersectObject(earthMesh)

        if (intersects.length > 0) {
          const point = intersects[0].point
          const { lat, lon } = vector3ToLatLon(point)

          try {
            const tz = tzlookup(lat, lon)
            const now = new Date()
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              timeZoneName: 'shortOffset'
            })
            const parts = formatter.formatToParts(now)
            const offsetPart = parts.find(p => p.type === 'timeZoneName')
            const offset = offsetPart ? offsetPart.value : ''

            tooltipRef.current.textContent = `${tz} · ${offset}`
            tooltipRef.current.style.display = 'block'
            tooltipRef.current.style.left = `${e.clientX + 16}px`
            tooltipRef.current.style.top = `${e.clientY + 16}px`

            // Throttle point-in-polygon search to when mouse moves > 3px
            const dx = e.clientX - (lastMousePos.current?.x || 0)
            const dy = e.clientY - (lastMousePos.current?.y || 0)
            if (dx * dx + dy * dy >= 9) {
              lastMousePos.current = { x: e.clientX, y: e.clientY }

              // Find which GeoJSON feature contains this point
              let matchedFeatureIndex = null
              const tzData = timezoneDataRef.current
              if (tzData) {
                for (let i = 0; i < tzData.features.length; i++) {
                  const feature = tzData.features[i]
                  const geom = feature.geometry
                  let polygons = []

                  if (geom.type === 'Polygon') {
                    polygons = [geom.coordinates]
                  } else if (geom.type === 'MultiPolygon') {
                    polygons = geom.coordinates
                  }

                  for (const polygon of polygons) {
                    if (pointInPolygon([lon, lat], polygon)) {
                      matchedFeatureIndex = i
                      break
                    }
                  }
                  if (matchedFeatureIndex !== null) break
                }
              }

              if (matchedFeatureIndex !== null && matchedFeatureIndex !== highlightedTimezoneRef.current) {
                highlightedTimezoneRef.current = matchedFeatureIndex
                const tzGroup = sceneRef.current.getObjectByName('timezone-boundaries')
                if (tzGroup) {
                  tzGroup.traverse((child) => {
                    if (child.material && child.userData.featureIndex !== undefined) {
                      if (child.userData.featureIndex === matchedFeatureIndex) {
                        child.material.opacity = 1.0
                        child.material.color.setHex(isBWMode ? 0x000000 : 0xffffff)
                      } else {
                        child.material.opacity = 0.1
                        child.material.color.setHex(isBWMode ? 0x0f0f0f : 0xffffff)
                      }
                    }
                  })
                }
              } else if (matchedFeatureIndex === null && highlightedTimezoneRef.current !== null) {
                resetHighlight()
              }
            }
          } catch {
            tooltipRef.current.style.display = 'none'
            resetHighlight()
          }
        } else {
          tooltipRef.current.style.display = 'none'
          resetHighlight()
        }
      }

      const handleMouseLeave = () => {
        if (tooltipRef.current && !showFirRegions) tooltipRef.current.style.display = 'none'
        resetHighlight()
      }

      canvas.addEventListener('mousemove', handleMouseMove)
      canvas.addEventListener('mouseleave', handleMouseLeave)

      return () => {
        canvas.removeEventListener('mousemove', handleMouseMove)
        canvas.removeEventListener('mouseleave', handleMouseLeave)
      }
    }, [showTimezones, showFirRegions, isMobile, isBWMode])

    useEffect(() => {
      if (!twilightLinesRef.current.terminatorDay) return
      
      const duration = 300 // milliseconds
      const startTime = Date.now()
      
      // Store starting opacities
      const startOpacities = {
        terminator: twilightLinesRef.current.terminatorDay.material.opacity,
        civil: twilightLinesRef.current.civilDay.material.opacity,
        nautical: twilightLinesRef.current.nauticalDay.material.opacity,
        astronomical: twilightLinesRef.current.astronomicalDay.material.opacity
      }
      
      // Target opacities based on toggle state
      const targetOpacities = showTwilightLines ? {
        terminator: 0.8,
        civil: 0.6,
        nautical: 0.4,
        astronomical: 0.3
      } : {
        terminator: 0,
        civil: 0,
        nautical: 0,
        astronomical: 0
      }
      
      const animate = () => {
        const elapsed = Date.now() - startTime
        const t = Math.min(elapsed / duration, 1)
        const easeT = t * (2 - t) // Ease out
        
        // Interpolate opacities
        const currentOpacities = {
          terminator: startOpacities.terminator + (targetOpacities.terminator - startOpacities.terminator) * easeT,
          civil: startOpacities.civil + (targetOpacities.civil - startOpacities.civil) * easeT,
          nautical: startOpacities.nautical + (targetOpacities.nautical - startOpacities.nautical) * easeT,
          astronomical: startOpacities.astronomical + (targetOpacities.astronomical - startOpacities.astronomical) * easeT
        }
        
        // Update all line materials
        twilightLinesRef.current.terminatorDay.material.opacity = currentOpacities.terminator
        twilightLinesRef.current.terminatorNight.material.opacity = currentOpacities.terminator
        twilightLinesRef.current.civilDay.material.opacity = currentOpacities.civil
        twilightLinesRef.current.civilNight.material.opacity = currentOpacities.civil
        twilightLinesRef.current.nauticalDay.material.opacity = currentOpacities.nautical
        twilightLinesRef.current.nauticalNight.material.opacity = currentOpacities.nautical
        twilightLinesRef.current.astronomicalDay.material.opacity = currentOpacities.astronomical
        twilightLinesRef.current.astronomicalNight.material.opacity = currentOpacities.astronomical
        
        if (t < 1) {
          requestAnimationFrame(animate)
        } else {
          // At end of fade-out, hide the lines
          if (!showTwilightLines) {
            twilightLinesRef.current.terminatorDay.visible = false
            twilightLinesRef.current.terminatorNight.visible = false
            twilightLinesRef.current.civilDay.visible = false
            twilightLinesRef.current.civilNight.visible = false
            twilightLinesRef.current.nauticalDay.visible = false
            twilightLinesRef.current.nauticalNight.visible = false
            twilightLinesRef.current.astronomicalDay.visible = false
            twilightLinesRef.current.astronomicalNight.visible = false
          }
        }
      }
      
      // At start of fade-in, show the lines
      if (showTwilightLines) {
        twilightLinesRef.current.terminatorDay.visible = true
        twilightLinesRef.current.terminatorNight.visible = true
        twilightLinesRef.current.civilDay.visible = true
        twilightLinesRef.current.civilNight.visible = false // Night side twilight hidden
        twilightLinesRef.current.nauticalDay.visible = true
        twilightLinesRef.current.nauticalNight.visible = false
        twilightLinesRef.current.astronomicalDay.visible = true
        twilightLinesRef.current.astronomicalNight.visible = false
      }
      
      animate()
      
    }, [showTwilightLines])

    useEffect(() => {
      if (twilightLinesRef.current.terminatorDay) {
        // In BW mode: dark gray for all
        // In color mode: different blues for each twilight type
        
        if (isBWMode) {
          const color = 0x202020  // Dark gray
          
          twilightLinesRef.current.terminatorDay.material.color.setHex(color)
          twilightLinesRef.current.terminatorNight.material.color.setHex(color)
          twilightLinesRef.current.civilDay.material.color.setHex(color)
          twilightLinesRef.current.civilNight.material.color.setHex(color)
          twilightLinesRef.current.nauticalDay.material.color.setHex(color)
          twilightLinesRef.current.nauticalNight.material.color.setHex(color)
          twilightLinesRef.current.astronomicalDay.material.color.setHex(color)
          twilightLinesRef.current.astronomicalNight.material.color.setHex(color)
        } else {
          // Color mode: different shades of blue
          twilightLinesRef.current.terminatorDay.material.color.setHex(0xd8e8f8)  // Pale blue
          twilightLinesRef.current.terminatorNight.material.color.setHex(0xd8e8f8)
          twilightLinesRef.current.civilDay.material.color.setHex(0x6ba3d8)  // Light blue
          twilightLinesRef.current.civilNight.material.color.setHex(0x6ba3d8)
          twilightLinesRef.current.nauticalDay.material.color.setHex(0x4a7fb8)  // Medium blue
          twilightLinesRef.current.nauticalNight.material.color.setHex(0x4a7fb8)
          twilightLinesRef.current.astronomicalDay.material.color.setHex(0x3d6fa0)  // Dark blue
          twilightLinesRef.current.astronomicalNight.material.color.setHex(0x3d6fa0)
        }
      }
    }, [isBWMode])

    useEffect(() => {
      if (!isPlaying || !flightDataRef.current) return
      
      // Get flight distance in km from flightResults
      const flightDistanceKm = flightResults ? parseFloat(flightResults.distance) : 5000
      
      // Define speed in km per second of animation
      // Slower for short flights so the animation doesn't feel rushed
      // 400 km/s above 2000km, scaling down to 150 km/s for very short flights
      const kmPerSecond = flightDistanceKm >= 2000 ? 400 : 
        150 + (250 * Math.max(0, (flightDistanceKm - 200) / 1800))
      
      // Calculate total animation duration based on distance
      const animationDurationMs = (flightDistanceKm / kmPerSecond) * 1000
      
      const updateInterval = 16
      const increment = updateInterval / animationDurationMs
      
      const interval = setInterval(() => {
        setAnimationProgress(prev => {
          const newProgress = Math.min(prev + increment, 1.0)  // Clamp to exactly 1.0
          animationProgressRef.current = newProgress
          if (newProgress >= 1) {
            setIsPlaying(false)
            setShowFlightStats(true)
          }
          return newProgress
        })
      }, updateInterval)
      
      return () => clearInterval(interval)
    }, [isPlaying, flightResults])

    // Keyboard controls for animation
    useEffect(() => {
      const handleKeyPress = (e) => {

          // Ignore keyboard shortcuts when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          return
        }
        
        // Only respond to spacebar when there's a flight
        if (e.code === 'Space' && hasFlightPathRef.current) {
          e.preventDefault()
          
          if (animationProgressRef.current >= 1) {
            setAnimationProgress(0)
            animationProgressRef.current = 0
            setShowFlightStats(true)
          }
          
          if (!isPlayingRef.current) {
            setShowFlightStats(false)
          }
          
          setIsPlaying(prev => !prev)
        }

        // A for airports toggle
        if (e.key === 'a' || e.key === 'A') {
          setShowAirports(prev => !prev)
        }

        // P for plane toggle
        if (e.key === 'p' || e.key === 'P') {
          setShowPlaneIcon(prev => {
            showPlaneIconRef.current = !prev
            return !prev
          })
        }

        // T for timezones toggle
        if (e.key === 't' || e.key === 'T') {
          if (!showTimezones) {
            setShowGraticule(false)
            setShowFirRegions(false)
            setTimeout(() => setShowTimezones(true), 50)
          } else {
            setShowTimezones(false)
            setTimeout(() => setShowGraticule(true), 50)
          }
        }

        // G for graticule toggle
        if (e.key === 'g' || e.key === 'G') {
          if (!showGraticule) {
            setShowTimezones(false)
            setShowFirRegions(false)
            setTimeout(() => setShowGraticule(true), 50)
          } else {
            setShowGraticule(false)
          }
        }

        // L for twilight lines toggle
        if (e.key === 'l' || e.key === 'L') {
          setShowTwilightLines(prev => !prev)
        }

        // F for FIR regions toggle
        if (e.key === 'f' || e.key === 'F') {
          if (!showFirRegions) {
            setShowGraticule(false)
            setShowTimezones(false)
            setTimeout(() => setShowFirRegions(true), 50)
          } else {
            setShowFirRegions(false)
            setTimeout(() => setShowGraticule(true), 50)
          }
        }

      }
      
      window.addEventListener('keydown', handleKeyPress)
      
      return () => {
        window.removeEventListener('keydown', handleKeyPress)
      }

    }, [showTimezones, showGraticule, showFirRegions])

    const centerCameraOnFlight = (departure, arrival, flightDistance) => {
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (!camera || !controls) return

      // Distance-based camera zoom
      const { cameraRadius, scaleFactor } = getFlightScale(flightDistance)
      const radius = cameraRadius

      // Widen OrbitControls limits to allow smooth transition from current to target distance
      const currentDistance = camera.position.length()
      controls.minDistance = Math.min(currentDistance, cameraRadius) - 0.2
      controls.maxDistance = Math.max(currentDistance, cameraRadius) + 0.2

      // Convert to radians
      const lat1 = departure.lat * Math.PI / 180
      const lon1 = departure.lon * Math.PI / 180
      const lat2 = arrival.lat * Math.PI / 180
      const lon2 = arrival.lon * Math.PI / 180

      // Calculate great circle midpoint (fraction = 0.5)
      const angularDistance = Math.acos(
        Math.sin(lat1) * Math.sin(lat2) + 
        Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
      )
      
      const a = Math.sin(0.5 * angularDistance) / Math.sin(angularDistance)
      const b = Math.sin(0.5 * angularDistance) / Math.sin(angularDistance)
      
      const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
      const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
      const z = a * Math.sin(lat1) + b * Math.sin(lat2)
      
      const midLat = isMobile ? departure.lat : Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
      const midLon = isMobile ? departure.lon : Math.atan2(y, x) * 180 / Math.PI

      // Calculate base camera position (directly above midpoint)
      const basePosition = latLonToVector3(midLat, midLon, radius)

      // Apply south tilt — disabled for closer zoom to keep path centered
      const tiltAngle = (10 * scaleFactor) * Math.PI / 180
      const planeNormal = basePosition.clone().normalize()
      
      // Calculate "south" direction
      const south = new THREE.Vector3(0, -1, 0)
      const east = new THREE.Vector3().crossVectors(planeNormal, south).normalize()
      const actualSouth = new THREE.Vector3().crossVectors(east, planeNormal).normalize()
      
      // Tilt the normal slightly toward south
      const tiltedNormal = planeNormal.clone()
        .multiplyScalar(Math.cos(tiltAngle))
        .add(actualSouth.multiplyScalar(Math.sin(tiltAngle)))
        .normalize()
      
      // Final target position with tilt
      const targetPosition = tiltedNormal.multiplyScalar(radius)

      // Smooth animation to target position
      const startPosition = camera.position.clone()
      const startRadius = camera.position.length()
      const duration = 1500
      const startTime = Date.now()

      // Bump scale: ramp from 5 (far) to 12 (close) based on camera distance
      const bumpFromRadius = (r) => 7 + (3.5 - Math.max(2.3, Math.min(3.5, r))) / (3.5 - 2.3) * 7
      const startBump = bumpFromRadius(startRadius)
      const endBump = bumpFromRadius(radius)
      targetBumpScaleRef.current = endBump

      const animateCamera = () => {
        const elapsed = Date.now() - startTime
        const progress = Math.min(elapsed / duration, 1)

        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2

        // Spherical interpolation (slerp) - maintain constant distance from origin
        const startNormal = startPosition.clone().normalize()
        const targetNormal = targetPosition.clone().normalize()

        // Calculate angle between start and target
        const angle = startNormal.angleTo(targetNormal)

        // Interpolate distance from current to target
        const currentRadius = startRadius + (radius - startRadius) * eased

        // Interpolate bump scale with camera distance
        if (!isBWMode && earthMaterialRef.current) {
          earthMaterialRef.current.bumpScale = startBump + (endBump - startBump) * eased
        }

        // Handle edge case where positions are identical or opposite
        if (angle < 0.0001) {
          camera.position.copy(startNormal.clone().multiplyScalar(currentRadius))
        } else if (angle > Math.PI - 0.0001) {
          // Positions are opposite - use linear interpolation
          camera.position.lerpVectors(startPosition, targetPosition, eased)
        } else {
          // Normal case - use spherical interpolation
          const axis = new THREE.Vector3().crossVectors(startNormal, targetNormal).normalize()
          const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle * eased)
          const interpolatedNormal = startNormal.clone().applyQuaternion(quaternion)

          // Apply interpolated radius (smooth zoom)
          camera.position.copy(interpolatedNormal.multiplyScalar(currentRadius))
        }

        camera.lookAt(0, 0, 0)
        controls.update()

        if (progress < 1) {
          requestAnimationFrame(animateCamera)
        } else {
          // Tighten OrbitControls limits to final distance
          controls.minDistance = cameraRadius - 0.2
          controls.maxDistance = cameraRadius + 0.2
        }
      }

      animateCamera()
    }

    const calculateFlight = () => {
      callsignControlPointsRef.current = null
      callsignArcLengthFractionsRef.current = null

      if (!airports) {
        return
      }
      
      const departure = airports[departureCode]
      const arrival = airports[arrivalCode]
      
      if (!departure) {
        return
      }
      
      if (!arrival) {
        return
      }
      
      
      // Calculate great circle distance
      const lat1 = departure.lat * Math.PI / 180
      const lon1 = departure.lon * Math.PI / 180
      const lat2 = arrival.lat * Math.PI / 180
      const lon2 = arrival.lon * Math.PI / 180
      
      const earthRadius = 6371 // km
      const angularDistance = Math.acos(
        Math.sin(lat1) * Math.sin(lat2) + 
        Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
      )
      const distance = earthRadius * angularDistance
      
      // Estimate flight duration (average cruise speed ~750 km/h)
      const cruiseSpeed = 750 // km/h
      const flightDurationHours = distance / cruiseSpeed
      const flightDurationMs = flightDurationHours * 60 * 60 * 1000
      
      
      // Sample points along the route and check daylight
      const numSamples = 2000
      let daylightSegments = 0

      for (let i = 0; i < numSamples; i++) {  // Changed to < instead of <=
        const fraction = (i + 0.5) / numSamples  // Sample at midpoint of each segment
        
        // Calculate position along route
        const a = Math.sin((1 - fraction) * angularDistance) / Math.sin(angularDistance)
        const b = Math.sin(fraction * angularDistance) / Math.sin(angularDistance)
        
        const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
        const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
        const z = a * Math.sin(lat1) + b * Math.sin(lat2)
        
        const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
        const lon = Math.atan2(y, x) * 180 / Math.PI
        
        // Calculate time at this point
        const timeAtPoint = new Date(departureTime.getTime() + fraction * flightDurationMs)
        
        // Check if in daylight
        const inDaylight = isPointInDaylight(lat, lon, timeAtPoint)
        
        if (inDaylight) {
          daylightSegments++
        }
      }

      // Convert segment counts to time
      const totalFlightMins = Math.round(flightDurationHours * 60)
      const daylightTotalMins = Math.round((daylightSegments / numSamples) * totalFlightMins)
      const darknessTotalMins = totalFlightMins - daylightTotalMins

      // Convert back to hours:minutes
      const totalDurationHours = Math.floor(totalFlightMins / 60)
      const totalDurationMins = totalFlightMins % 60

      const daylightHours = Math.floor(daylightTotalMins / 60)
      const daylightMins = daylightTotalMins % 60

      const darknessHours = Math.floor(darknessTotalMins / 60)
      const darknessMins = darknessTotalMins % 60

      const results = {
        distance: Math.round(distance),
        duration: flightDurationHours.toFixed(1),
        durationHours: totalDurationHours,
        durationMins: totalDurationMins,
        daylightHours,
        daylightMins,
        darknessHours,
        darknessMins
      }
      
      setFlightResults(results)
      setFollowPlaneMode(true)
      setIsPanelCollapsed(true)
      setShowFlightStats(true)

      // Trigger flight path drawing
      setFlightPath({ departure, arrival })

      // Store flight data for animation
      flightDataRef.current = {
        departure,
        arrival,
        departureTime,
        flightDurationMs
      }

      // Reset animation progress when new flight is calculated
      setAnimationProgress(0)
      animationProgressRef.current = 0

      // Center camera on flight path
      centerCameraOnFlight(departure, arrival, distance)

      // Scale plane icon for flight distance
      const { scaleFactor } = getFlightScale(distance)
      const planeScale = scaleFactor * viewportScaleRef.current
      if (planeIconRef.current) {
        planeIconRef.current.scale.set(planeScale, 1, planeScale)
      }

      // Stop auto-rotation when flight is calculated
      setAutoRotate(false)
      autoRotateRef.current = false

      // Update URL with flight parameters
      const dateStr = departureTime.toISOString().split('T')[0] // Format: 2026-01-15
      const timeStr = departureTime.toTimeString().slice(0, 5).replace(':', '') // Format: 1430
      navigate(`/flight/${departureCode}-${arrivalCode}/${dateStr}/${timeStr}`, { replace: true })

    }

    const handleCallsignSearch = async (inputOverride) => {
      const flightId = (inputOverride ?? callsignInput).trim()
      setIsCallsignSearching(true)
      setCallsignError(null)
      try {
        const result = await lookupFlight(flightId)
        if (!result) {
          setCallsignError('Flight not found in the last 14 days')
        } else {
          setCallsignSearchResult(result)
          // Set default departure time from typicalDepartureTimeUtc
          if (result.typicalDepartureTimeUtc) {
            const [hh, mm] = result.typicalDepartureTimeUtc.split(':').map(Number)
            const now = new Date()
            now.setUTCHours(hh, mm, 0, 0)
            setDepartureTime(now)
          }
        }
      } catch (err) {
        if (err.message === 'rate_limited') {
          setCallsignError('Flight data is temporarily unavailable. Please try again later.')
        } else if (err.message === 'server_error') {
          setCallsignError('Flight data service is temporarily unavailable. Please try again later.')
        } else {
          setCallsignError('Unable to search flights. Please try again.')
        }
      } finally {
        setIsCallsignSearching(false)
      }
    }

    const handleCallsignStart = async () => {
      if (!callsignSearchResult) return

      try {
        const { summary, events, totalDurationMs } = callsignSearchResult

        if (!events?.length) {
          setCallsignError('No flight events found for this flight.')
          return
        }

        // Look up airports by ICAO
        const departureAirportObj = airportsIcao?.[summary.orig_icao] ?? null
        const destIcao = summary.dest_icao_actual ?? summary.dest_icao
        const arrivalAirportObj = airportsIcao?.[destIcao] ?? null

        if (!departureAirportObj || !arrivalAirportObj) {
          setCallsignError('Could not resolve airport coordinates for this flight.')
          return
        }

        setDepartureCode(departureAirportObj.iata || summary.orig_icao)
        setArrivalCode(arrivalAirportObj.iata || destIcao)
        setDepartureAirport(departureAirportObj)
        setArrivalAirport(arrivalAirportObj)

        // Build control points with absolute timestamps derived from
        // user-chosen departureTime + relative offsets
        const baseTime = departureTime.getTime()
        const controlPointsWithTime = events
          .filter(e => e.lat != null && e.lon != null)
          .map(e => ({
            lat: e.lat,
            lon: e.lon,
            timestamp: new Date(baseTime + e.offsetMs).toISOString(),
          }))

        // Fallback: insufficient waypoints — degrade to great circle
        if (controlPointsWithTime.length < 2) {
          callsignControlPointsRef.current = null
          callsignArcLengthFractionsRef.current = null
          calculateFlight()
          return
        }

        // Add airport endpoints
        const firstOffset = events[0]?.offsetMs ?? 0
        const lastOffset = events[events.length - 1]?.offsetMs ?? totalDurationMs
        const controlPoints = [
          { lat: departureAirportObj.lat, lon: departureAirportObj.lon, timestamp: new Date(baseTime + firstOffset).toISOString() },
          ...controlPointsWithTime,
          { lat: arrivalAirportObj.lat, lon: arrivalAirportObj.lon, timestamp: new Date(baseTime + lastOffset).toISOString() },
        ]

        // Filter out near-duplicate control points to prevent CatmullRom loops.
        // Points closer than threshold km to their predecessor are removed.
        const MIN_CP_DISTANCE_KM = 50
        const filteredControlPoints = [controlPoints[0]]
        for (let i = 1; i < controlPoints.length; i++) {
          const prev = filteredControlPoints[filteredControlPoints.length - 1]
          const curr = controlPoints[i]
          const dLat = (curr.lat - prev.lat) * Math.PI / 180
          const dLon = (curr.lon - prev.lon) * Math.PI / 180
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2
          const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
          if (distKm >= MIN_CP_DISTANCE_KM || i === controlPoints.length - 1) {
            filteredControlPoints.push(curr)
          }
        }

        callsignControlPointsRef.current = filteredControlPoints

        // Great circle distance for camera/scale
        const lat1 = departureAirportObj.lat * Math.PI / 180
        const lon1 = departureAirportObj.lon * Math.PI / 180
        const lat2 = arrivalAirportObj.lat * Math.PI / 180
        const lon2 = arrivalAirportObj.lon * Math.PI / 180
        const earthRadius = 6371
        const angularDistance = Math.acos(
          Math.sin(lat1) * Math.sin(lat2) +
          Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
        )
        const distance = earthRadius * angularDistance

        // Duration from relative offsets
        const durationMs = totalDurationMs
        const durationHours = durationMs / 3_600_000
        const totalFlightMins = Math.round(durationHours * 60)

        // Sample daylight along the route using user-chosen date + offsets
        const numSamples = 2000
        let daylightSegments = 0
        const cpVecs = callsignControlPointsRef.current.map(cp => latLonToVector3(cp.lat, cp.lon, 2.01))
        const catmullCurve = new THREE.CatmullRomCurve3(cpVecs, false, 'catmullrom', CATMULLROM_TENSION)

        const lengths = catmullCurve.getLengths(callsignControlPointsRef.current.length - 1)
        const totalLen = lengths[lengths.length - 1]
        const arcLengthFractions = lengths.map(l => l / totalLen)
        callsignArcLengthFractionsRef.current = arcLengthFractions

        // Compute real route distance by summing haversine segments along the CatmullRom curve
        const routeSamples = 500
        let realDistanceKm = 0
        let prevLat = null, prevLon = null
        for (let i = 0; i <= routeSamples; i++) {
          const fraction = i / routeSamples
          const pt = catmullCurve.getPointAt(fraction)
          pt.normalize().multiplyScalar(2.01)
          const sLat = Math.asin(pt.y / 2.01) * 180 / Math.PI
          const sLon = Math.atan2(pt.z, -pt.x) * 180 / Math.PI - 180
          if (prevLat !== null) {
            const dLat = (sLat - prevLat) * Math.PI / 180
            const dLon = (sLon - prevLon) * Math.PI / 180
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(prevLat * Math.PI / 180) * Math.cos(sLat * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
            realDistanceKm += 6371 * c
          }
          prevLat = sLat
          prevLon = sLon
        }

        for (let i = 0; i < numSamples; i++) {
          const fraction = (i + 0.5) / numSamples
          const pt = catmullCurve.getPointAt(fraction)
          pt.normalize().multiplyScalar(2.01)
          const lat = Math.asin(pt.y / 2.01) * 180 / Math.PI
          const lon = Math.atan2(pt.z, -pt.x) * 180 / Math.PI - 180
          const timeAtPoint = interpolateTimestamp(controlPoints, fraction, arcLengthFractions)
          if (isPointInDaylight(lat, lon, timeAtPoint)) daylightSegments++
        }

        const daylightTotalMins = Math.round((daylightSegments / numSamples) * totalFlightMins)
        const darknessTotalMins = totalFlightMins - daylightTotalMins

        const results = {
          distance: Math.round(realDistanceKm),
          duration: durationHours.toFixed(1),
          durationHours: Math.floor(totalFlightMins / 60),
          durationMins: totalFlightMins % 60,
          daylightHours: Math.floor(daylightTotalMins / 60),
          daylightMins: daylightTotalMins % 60,
          darknessHours: Math.floor(darknessTotalMins / 60),
          darknessMins: darknessTotalMins % 60,
        }

        setFlightResults(results)
        setFollowPlaneMode(true)
        setIsPanelCollapsed(true)
        setShowFlightStats(true)
        setFlightPath({ departure: departureAirportObj, arrival: arrivalAirportObj })

        flightDataRef.current = {
          departure: departureAirportObj,
          arrival: arrivalAirportObj,
          departureTime: departureTime,
          flightDurationMs: durationMs,
        }

        setAnimationProgress(0)
        animationProgressRef.current = 0

        centerCameraOnFlight(departureAirportObj, arrivalAirportObj, distance)

        const { scaleFactor } = getFlightScale(distance)
        const planeScale = scaleFactor * viewportScaleRef.current
        if (planeIconRef.current) {
          planeIconRef.current.scale.set(planeScale, 1, planeScale)
        }

        setAutoRotate(false)
        autoRotateRef.current = false

        const dt = DateTime.fromJSDate(departureTime, { zone: 'utc' })
        navigate(`/flight/${callsignInput.trim()}/${dt.toFormat('yyyy-MM-dd')}/${dt.toFormat('HHmm')}`, { replace: true })
      } catch {
        setCallsignError('Unable to load flight route. Please try again.')
      }
    }

    const getAirportTimezone = (airport) => {
      try {
        const tz = tzlookup(airport.lat, airport.lon)
        return tz
      } catch {
        // Fallback to UTC offset if lookup fails
        const offset = Math.round(airport.lon / 15)
        return `UTC${offset >= 0 ? '+' : ''}${offset}`
      }
    }
    
    const getLocalTimeAtAirport = (utcTime, airport) => {
      const timezone = getAirportTimezone(airport)
      const dt = DateTime.fromJSDate(utcTime, { zone: timezone })
      return dt.toFormat('HH:mm')
    }
    
    const getTimezoneAbbreviation = (airport) => {
      const timezone = getAirportTimezone(airport)
      const dt = DateTime.now().setZone(timezone)
      return dt.toFormat('ZZZZ') // Returns abbreviation like "PST", "CET"
    }

    const formatFlightTime = (progress, results) => {
      const totalMins = results.durationHours * 60 + results.durationMins
      const elapsedMins = Math.round(progress * totalMins)
      const hours = Math.floor(elapsedMins / 60)
      const mins = elapsedMins % 60
      return `${hours}h ${mins}m`
    }

    const handleProgressChange = (newProgress) => {
      setAnimationProgress(newProgress)
      animationProgressRef.current = newProgress
    }

    const searchAirports = (query) => {
      if (!airports || query.length < 2) return []
      
      const upperQuery = query.toUpperCase()
      const exactCodeMatches = []
      const codeStartMatches = []
      const cityMatches = []
      const airportNameMatches = []

      // Search through all airports
      for (const [code, airport] of Object.entries(airports)) {
        // Exact IATA code match (e.g., "CAT" matches "CAT")
        if (code === upperQuery) {
          exactCodeMatches.push({ code, ...airport })
        }
        // IATA code starts with query (e.g., "CA" matches "CAT")
        else if (code.startsWith(upperQuery)) {
          codeStartMatches.push({ code, ...airport })
        }
        // City name contains query (e.g., "York" matches "New York")
        else if (airport.city.toUpperCase().includes(upperQuery)) {
          cityMatches.push({ code, ...airport })
        }
        // Airport name contains query (e.g., "Milan" matches "Milan Malpensa Airport")
        else if (airport.name.toUpperCase().includes(upperQuery)) {
          airportNameMatches.push({ code, ...airport })
        }
      }

      // Sort each category by score descending (highest score first)
      exactCodeMatches.sort((a, b) => b.score - a.score)
      codeStartMatches.sort((a, b) => b.score - a.score)
      cityMatches.sort((a, b) => b.score - a.score)
      airportNameMatches.sort((a, b) => b.score - a.score)

      // Return results in priority order: exact codes, code prefixes, city matches, airport name matches
      return [...exactCodeMatches, ...codeStartMatches, ...cityMatches, ...airportNameMatches].slice(0, 8)
    }

    const searchAirlines = (query) => {
      if (!airlines || query.length < 2) return []

      const upperQuery = query.toUpperCase()
      const exactIataMatches = []
      const iataStartMatches = []
      const exactIcaoMatches = []
      const icaoStartMatches = []
      const nameMatches = []
      const aliasMatches = []

      for (const airline of airlines) {
        const iata = (airline.iata ?? '').toUpperCase()
        const name = (airline.name ?? '').toUpperCase()
        const icao = (airline.icao ?? '').toUpperCase()
        const alias = (airline.alias ?? '').toUpperCase()

        if (iata === upperQuery) {
          exactIataMatches.push(airline)
        } else if (iata.startsWith(upperQuery)) {
          iataStartMatches.push(airline)
        } else if (icao === upperQuery) {
          exactIcaoMatches.push(airline)
        } else if (icao.startsWith(upperQuery)) {
          icaoStartMatches.push(airline)
        } else if (name.includes(upperQuery)) {
          nameMatches.push(airline)
        } else if (alias && alias.includes(upperQuery)) {
          aliasMatches.push(airline)
        }
      }

      return [...exactIataMatches, ...iataStartMatches, ...exactIcaoMatches, ...icaoStartMatches, ...nameMatches, ...aliasMatches].slice(0, 8)
    }

    const loadMarkdownContent = async (filename, section) => {
      try {
        // If clicking the same section, close it with animation
        if (expandedSection === section) {
          setIsClosing(true)
          setTimeout(() => {
            setExpandedSection(null)
            setIsClosing(false)
          }, 250) // Match animation duration
          return
        }
        
        const response = await fetch(`/content/${filename}`)
        const text = await response.text()
        
        if (section === 'about') {
          setAboutContent(text)
        } else if (section === 'data') {
          setDataContent(text)
        }
        
        setExpandedSection(section)
      } catch (error) {
        console.error('Error loading content:', error)
      }
    }

    const getLocalDateAtAirport = (date, airport) => {
      if (!airport) return ''
      const timezone = getAirportTimezone(airport)
      const dt = DateTime.fromJSDate(date, { zone: timezone })
      return dt.toFormat('MMM d').toUpperCase()
    }

    // Update scene background when B&W mode changes
    useEffect(() => {
      // Sync isBWMode state to ref and update colors
      isBWModeRef.current = isBWMode
      
      // Update Safari status bar and html background
      document.documentElement.style.background = isBWMode ? BG_COLOR_BW : BG_COLOR_DARK
      const meta = document.getElementById('theme-color-meta')
      if (meta) meta.setAttribute('content', isBWMode ? BG_COLOR_BW : BG_COLOR_DARK)
      
      if (isBWMode) {
        const appElement = document.querySelector('.bw-mode')
        if (appElement) {
          bwColorsRef.current = {
            day: getCSSColor('--path-day-color', appElement),
            twilight: getCSSColor('--path-twilight-warm', appElement),
            night: getCSSColor('--path-night-color', appElement)
          }
        }
      }

      if (!sceneRef.current) return
      
      // Target values for each mode
      const targets = isBWMode ? {
        bgColor: new THREE.Color(BG_COLOR_BW),
        ambientIntensity: 1.8,
        overlayIntensity: 0.55,
        graticuleColor: 0x0f0f0f
      } : {
        bgColor: new THREE.Color(BG_COLOR_DARK),
        ambientIntensity: 0.3,
        overlayIntensity: 0.65,
        graticuleColor: 0xffffff
      }
      
      // Capture starting values
      const startBg = sceneRef.current.background.clone()
      const startAmbient = ambientLightRef.current?.intensity || 0.3
      const startOverlay = twilightSphereRef.current?.material.uniforms.overlayIntensity.value || 0.65
      
      // Prepare label texture updates (load new icons immediately)
      let newDepTexture = null
      let newArrTexture = null
      let newPlaneTexture = isBWMode ? planeBWTextureRef.current : planeTextureRef.current
      
      const createLabelTexture = (code, type, callback) => {
        const iconSrc = type === 'departure' 
          ? (isBWMode ? '/departure-icon-bw.svg' : '/departure-icon.svg')
          : (isBWMode ? '/arrival-icon-bw.svg' : '/arrival-icon.svg')
        
        createAirportLabelTexture(code, iconSrc, isBWMode).then(callback)
      }
      
      // Start loading new textures
      if (departureLabelRef.current?.userData.code) {
        createLabelTexture(departureLabelRef.current.userData.code, 'departure', (tex) => {
          newDepTexture = tex
        })
      }
      if (arrivalLabelRef.current?.userData.code) {
        createLabelTexture(arrivalLabelRef.current.userData.code, 'arrival', (tex) => {
          newArrTexture = tex
        })
      }
      
      // Store original opacities
      const depOriginalOpacity = departureLabelRef.current?.material.opacity || 1
      const arrOriginalOpacity = arrivalLabelRef.current?.material.opacity || 1
      const planeOriginalOpacity = planeIconRef.current?.material.opacity || 1
      
      // Track if textures have been swapped (at midpoint)
      let texturesSwapped = false
      
      // Animate the transition
      const duration = 400 // milliseconds
      const startTime = Date.now()
      
      const animateTransition = () => {
        const elapsed = Date.now() - startTime
        const t = Math.min(elapsed / duration, 1)
        const easeT = t * (2 - t) // Ease out
        
        // Interpolate background color
        sceneRef.current.background.lerpColors(startBg, targets.bgColor, easeT)
        
        // Interpolate ambient light
        if (ambientLightRef.current) {
          ambientLightRef.current.intensity = startAmbient + (targets.ambientIntensity - startAmbient) * easeT
        }
        
        // Interpolate overlay intensity
        if (twilightSphereRef.current) {
          twilightSphereRef.current.material.uniforms.overlayIntensity.value = 
            startOverlay + (targets.overlayIntensity - startOverlay) * easeT
        }
        
        // Interpolate bump scale
        const earthSphere = sceneRef.current.getObjectByName('earth-sphere')
        if (earthSphere) {
          const bumpTarget = targetBumpScaleRef.current
          const startBump = isBWMode ? bumpTarget : 0
          const endBump = isBWMode ? 0 : bumpTarget
          earthSphere.material.bumpScale = startBump + (endBump - startBump) * easeT
        }

        // Interpolate glow
        if (glowRef.current) {
          const startGlowColor = isBWMode ? new THREE.Vector3(1.5, 1.5, 1.5) : new THREE.Vector3(0.5, 0.5, 0.5)
          const endGlowColor = isBWMode ? new THREE.Vector3(0.5, 0.5, 0.5) : new THREE.Vector3(3.0, 3.5, 5.0)
          
          glowRef.current.material.uniforms.glowColor.value.set(
            startGlowColor.x + (endGlowColor.x - startGlowColor.x) * easeT,
            startGlowColor.y + (endGlowColor.y - startGlowColor.y) * easeT,
            startGlowColor.z + (endGlowColor.z - startGlowColor.z) * easeT
          )
          
          // Switch blending mode at the midpoint
          if (t >= 0.5 && !texturesSwapped) {
            glowRef.current.material.blending = isBWMode ? THREE.NormalBlending : THREE.AdditiveBlending
          }
        }

        // Interpolate graticule color
        const graticule = sceneRef.current.getObjectByName('graticule')
        if (graticule) {
          const startGraticuleColor = isBWMode ? new THREE.Color(0xffffff) : new THREE.Color(0x0f0f0f)
          const endGraticuleColor = new THREE.Color(targets.graticuleColor)
          const currentColor = new THREE.Color().lerpColors(startGraticuleColor, endGraticuleColor, easeT)
          
          graticule.traverse((child) => {
            if (child.material) {
              child.material.color.copy(currentColor)
            }
          })
        }

        // Interpolate timezone color
        const timezones = sceneRef.current.getObjectByName('timezone-boundaries')
        if (timezones) {
          const startTimezoneColor = isBWMode ? new THREE.Color(0xffffff) : new THREE.Color(0x0f0f0f)
          const endTimezoneColor = new THREE.Color(targets.graticuleColor)
          const currentColor = new THREE.Color().lerpColors(startTimezoneColor, endTimezoneColor, easeT)
          
          timezones.traverse((child) => {
            if (child.material) {
              child.material.color.copy(currentColor)
            }
          })
        }
        
        // Interpolate FIR boundaries color
        const firBoundaries = sceneRef.current.getObjectByName('fir-boundaries')
        if (firBoundaries) {
          const startFirColor = isBWMode ? new THREE.Color(0xffffff) : new THREE.Color(0x0f0f0f)
          const endFirColor = new THREE.Color(targets.graticuleColor)
          const currentFirColor = new THREE.Color().lerpColors(startFirColor, endFirColor, easeT)

          firBoundaries.traverse((child) => {
            if (child.material) {
              child.material.color.copy(currentFirColor)
            }
          })
        }

        // Interpolate departure/arrival dots color
        if (flightLineRef.current) {
          const startDotColor = isBWMode ? new THREE.Color(0xe0e0e0) : new THREE.Color(0x1a1a1a)
          const endDotColor = isBWMode ? new THREE.Color(0x1a1a1a) : new THREE.Color(0xe0e0e0)
          const currentDotColor = new THREE.Color().lerpColors(startDotColor, endDotColor, easeT)
          
          flightLineRef.current.traverse((child) => {
            if (child.isMesh && child.geometry.type === 'SphereGeometry') {
              child.material.color.copy(currentDotColor)
            }
          })
        }
        
        // Fade labels and plane: fade out first half, swap at midpoint, fade in second half
        const fadeT = t < 0.5 ? 1 - (t * 2) : (t - 0.5) * 2  // 1->0->1
        
        if (departureLabelRef.current) {
          departureLabelRef.current.material.opacity = depOriginalOpacity * fadeT
        }
        if (arrivalLabelRef.current) {
          arrivalLabelRef.current.material.opacity = arrOriginalOpacity * fadeT
        }
        if (planeIconRef.current) {
          planeIconRef.current.material.opacity = planeOriginalOpacity * fadeT
        }
        
        // Swap textures at midpoint
        if (t >= 0.5 && !texturesSwapped) {
          texturesSwapped = true
          
          // Swap plane texture
          if (planeIconRef.current && newPlaneTexture) {
            planeIconRef.current.material.map = newPlaneTexture
            planeIconRef.current.material.needsUpdate = true
          }

          // Swap progress tube colors
          if (progressTubeRef.current && flightLineRef.current) {
            const colorArr = isBWMode
              ? flightLineRef.current.userData.fullColorArrayBW
              : flightLineRef.current.userData.fullColorArrayColor
            if (colorArr) {
              progressTubeRef.current.geometry.attributes.color.array.set(colorArr)
              progressTubeRef.current.geometry.attributes.color.needsUpdate = true
            }
          }
          
          // Swap departure label texture
          if (departureLabelRef.current && newDepTexture) {
            if (departureLabelRef.current.material.map) {
              departureLabelRef.current.material.map.dispose()
            }
            departureLabelRef.current.material.map = newDepTexture
            departureLabelRef.current.material.needsUpdate = true
          }
          
          // Swap arrival label texture
          if (arrivalLabelRef.current && newArrTexture) {
            if (arrivalLabelRef.current.material.map) {
              arrivalLabelRef.current.material.map.dispose()
            }
            arrivalLabelRef.current.material.map = newArrTexture
            arrivalLabelRef.current.material.needsUpdate = true
          }
          
          // Toggle ocean mask for BW mode
          if (oceanShaderUniformsRef.current && oceanShaderUniformsRef.current.oceanMask) {
            oceanShaderUniformsRef.current.oceanMask.value = isBWMode ? new THREE.Texture() : oceanMaskTextureRef.current
          }

          // Update transition labels and rings
          transitionLabelsRef.current.forEach(label => {
            const timeText = label.userData.timeText
            const transitionType = label.userData.transitionType
            if (timeText && label.material.map) {
              createTransitionLabelTexture(timeText, transitionType, isBWMode).then(texture => {
                label.material.map.dispose()
                label.material.map = texture
                label.material.needsUpdate = true
              })
            }
            
            // Update ring color
            const ring = label.userData.ring
            if (ring) {
              ring.material.color.setHex(isBWMode ? 0x1a1a1a : 0xffffff)
            }
          })
        }
        
        if (t < 1) {
          requestAnimationFrame(animateTransition)
        } else {
          // Ensure final opacities are restored
          if (departureLabelRef.current) {
            departureLabelRef.current.material.opacity = depOriginalOpacity
          }
          if (arrivalLabelRef.current) {
            arrivalLabelRef.current.material.opacity = arrOriginalOpacity
          }
          if (planeIconRef.current) {
            planeIconRef.current.material.opacity = planeOriginalOpacity
          }
        }
      }
      
      animateTransition()
      
    }, [isBWMode])

    return (
      <div className={`app ${isLoading ? 'loading' : 'loaded'} ${isBWMode ? 'bw-mode' : ''} ${flightResults ? 'has-flight' : ''} ${showFlightStats ? 'stats-visible' : ''} ${isPlaying ? 'playing' : ''} ${showMobileMenu ? 'menu-open' : ''} ${isMobileMenuClosing ? 'menu-closing' : ''}`}>
        <div className="info-overlay">
          <img 
            src={isBWMode ? "/lightpath-logo-black.png" : "/lightpath-logo-white.png"}
            alt="Lightpath"
            className="logo"
            onClick={() => {
              navigate('/')
              setFlightPath(null)
              setFlightResults(null)
              setIsPanelCollapsed(false)
              setShowFlightStats(false)
              setDepartureCode('')
              setDepartureAirport(null)
              setArrivalCode('')
              setArrivalAirport(null)
              setAnimationProgress(0)
              setIsPlaying(false)
            }}
          />
        </div>

        {/* Hamburger menu button - shows on mobile */}
        {isMobile && (
          <button 
            className={`hamburger-button ${isHamburgerOpen ? 'open' : ''}`}
            onClick={() => {
              if (isMobileMenuAnimating) return
              if (!showMobileMenu) {
                setIsMobileMenuAnimating(true)
                setShowMobileMenu(true)
                setIsHamburgerOpen(true)
                setIsPanelCollapsed(true)  // ← add this
                setTimeout(() => setIsMobileMenuAnimating(false), 50)
              } else {
                setIsMobileMenuAnimating(true)
                setIsHamburgerOpen(false)
                setIsMobileMenuClosing(true)
                setExpandedSection(null)  // ← add this
                setTimeout(() => {
                  setShowMobileMenu(false)
                  setTimeout(() => {
                    setIsMobileMenuClosing(false)
                    setIsMobileMenuAnimating(false)
                  }, 300)
                }, 50)
              }
            }}
            aria-label="Menu"
          >
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
          </button>
        )}

        {/* Dark overlay behind mobile menu */}
        {showMobileMenu && (
          <div className={`mobile-menu-overlay-bg ${isMobileMenuClosing ? 'closing' : 'open'} ${isBWMode ? 'bw' : ''}`} />       
        )}
        
        {/* Mobile menu - sits behind canvas */}
        {showMobileMenu && (
          <div className="mobile-menu-offcanvas">
            <div className={`mobile-menu-content-wrap ${isMobileMenuClosing ? '' : 'visible'}`}>

              {aboutContent && (
                <div className="mobile-menu-about">
                  <ReactMarkdown components={{ a: ({node: _node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
                    {aboutContent.replace('{version}', packageJson.version)}
                  </ReactMarkdown>
                </div>
              )}
              
              <button 
                className="mobile-menu-link"
                onClick={() => loadMarkdownContent('data.md', 'data')}
              >
                Data
                <svg className={`nav-chevron ${expandedSection === 'data' ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              {expandedSection === 'data' && dataContent && (
                <div className="mobile-menu-accordion">
                  <ReactMarkdown components={{ a: ({node: _node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{dataContent}</ReactMarkdown>
                </div>
              )}
              
              </div>
              <div className="mobile-menu-bottom">
              
              <div className="mobile-menu-toggles">
                <label className="mobile-menu-toggle-item">
                  <input 
                    type="checkbox"
                    checked={showAirports}
                    onChange={(e) => setShowAirports(e.target.checked)}
                  />
                  <span>Airports</span>
                </label>
                
                <label className="mobile-menu-toggle-item">
                  <input 
                    type="checkbox"
                    checked={showGraticule}
                    onChange={(e) => {
                      const checked = e.target.checked
                      if (checked) {
                        setShowTimezones(false)
                        setShowFirRegions(false)
                        setTimeout(() => setShowGraticule(true), 50)
                      } else {
                        setShowGraticule(false)
                      }
                    }}
                  />
                  <span>Graticule</span>
                </label>

                <label className="mobile-menu-toggle-item">
                  <input
                    type="checkbox"
                    checked={showTwilightLines}
                    onChange={(e) => setShowTwilightLines(e.target.checked)}
                  />
                  <span>Twilight</span>
                </label>

                <label className="mobile-menu-toggle-item">
                  <input
                    type="checkbox"
                    checked={showTimezones}
                    onChange={(e) => {
                      const checked = e.target.checked
                      if (checked) {
                        setShowGraticule(false)
                        setShowFirRegions(false)
                        setTimeout(() => setShowTimezones(true), 50)
                      } else {
                        setShowTimezones(false)
                        setTimeout(() => setShowGraticule(true), 50)
                      }
                    }}
                  />
                  <span>Timezones</span>
                </label>
              </div>
              
              <div className="mobile-menu-footer">
                <img 
                  src={isBWMode ? "/github-icon-bw.svg" : "/github-icon.svg"}
                  alt="GitHub"
                  className="github-icon"
                />
                <a href="https://github.com/StudioFolder/lightpath" target="_blank" rel="noopener noreferrer">
                  {packageJson.version}
                </a>
                <span className="separator">·</span>
                <span>Made by</span>
                <a href="https://studiofolder.it" target="_blank" rel="noopener noreferrer">Studio Folder</a><span>(2026)</span>
                <span className="separator">·</span>
                <a href="mailto:lightpath@studiofolder.it">Get in touch</a>
              </div>
            </div>
          </div>
        )}

        <div className="nav-accordion">

          <button 
            className="nav-link"
            onClick={() => loadMarkdownContent('about.md', 'about')}
          >
            About
            <svg className={`nav-chevron ${expandedSection === 'about' ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {expandedSection === 'about' && aboutContent && (
            <div className={`accordion-content ${isClosing ? 'closing' : ''}`}>
              <ReactMarkdown components={{ a: ({node: _node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
                {aboutContent.replace('{version}', packageJson.version)}
              </ReactMarkdown>
            </div>
          )}
                    
          <button 
            className="nav-link"
            onClick={() => loadMarkdownContent('data.md', 'data')}
          >
            Data
            <svg className={`nav-chevron ${expandedSection === 'data' ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
            
          {expandedSection === 'data' && dataContent && (
            <div className={`accordion-content ${isClosing ? 'closing' : ''}`}>
              <ReactMarkdown components={{ a: ({node: _node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{dataContent}</ReactMarkdown>
            </div>
          )}

        </div>

        <div className="airport-toggle-overlay toggle-overlay">
          <label>
            <input 
              type="checkbox"
              checked={showAirports}
              onChange={(e) => setShowAirports(e.target.checked)}
            />
            <span><span className="key-circle">Ⓐ</span> <span className="toggle-label-text">Airports</span></span>
          </label>
        </div>

        <div className="graticule-toggle-overlay toggle-overlay">
          <label>
            <input 
              type="checkbox"
              checked={showGraticule}
              onChange={(e) => {
                const checked = e.target.checked
                if (checked) {
                  setShowTimezones(false)
                  setShowFirRegions(false)
                  setTimeout(() => setShowGraticule(true), 50)
                } else {
                  setShowGraticule(false)
                }
              }}
            />
            <span><span className="key-circle">Ⓖ</span> <span className="toggle-label-text">Graticule</span></span>
          </label>
        </div>

        <div className="twilight-toggle-overlay toggle-overlay">
          <label>
            <input 
              type="checkbox"
              checked={showTwilightLines}
              onChange={(e) => setShowTwilightLines(e.target.checked)}
            />
            <span><span className="key-circle">Ⓛ</span> <span className="toggle-label-text">Twilight</span></span>
          </label>
        </div>

        <div className="timezone-toggle-overlay toggle-overlay">
          <label>
            <input 
              type="checkbox"
              checked={showTimezones}
              onChange={(e) => {
                const checked = e.target.checked
                if (checked) {
                  setShowGraticule(false)
                  setShowFirRegions(false)
                  setTimeout(() => setShowTimezones(true), 50)
                } else {
                  setShowTimezones(false)
                  setTimeout(() => setShowGraticule(true), 50)
                }
              }}
            />
            <span><span className="key-circle">Ⓣ</span> <span className="toggle-label-text">Timezones</span></span>
          </label>
        </div>

        <div className="footer-info">
          <img 
            src={isBWMode ? "/github-icon-bw.svg" : "/github-icon.svg"}
            alt="GitHub"
            className="github-icon"
          />
          <a href="https://github.com/StudioFolder/lightpath" target="_blank" rel="noopener noreferrer">
            {packageJson.version}
          </a>
          <span className="separator">·</span>
          <span>Made by</span>
          <a href="https://studiofolder.it" target="_blank" rel="noopener noreferrer">Studio Folder</a><span>(2026)</span>
          <span className="separator">·</span>
          <a href="mailto:lightpath@studiofolder.it">Get in touch</a>
        </div>

        <div className="bw-toggle-overlay">
          <label>
            <div className="toggle-switch">
              <input 
                type="checkbox"
                checked={isBWMode}
                onChange={(e) => setIsBWMode(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </div>
            <span>Paper Mode</span>
          </label>
        </div>

        <div className="follow-toggle-overlay">
          <label>
            <div className="toggle-switch">
              <input 
                type="checkbox"
                checked={followPlaneMode}
                onChange={(e) => setFollowPlaneMode(e.target.checked)}
                disabled={!flightResults}
              />
              <span className="toggle-slider"></span>
            </div>
            <span>Follow Plane</span>
          </label>
        </div>
        
        <FlightInputPanel
          departureCode={departureCode}
          arrivalCode={arrivalCode}
          departureAirport={departureAirport}
          arrivalAirport={arrivalAirport}
          departureTime={departureTime}
          airports={airports}
          airportsIcao={airportsIcao}
          isPanelCollapsed={isPanelCollapsed}
          isPanelFading={isPanelFading}
          isBWMode={isBWMode}
          isMobile={isMobile}
          showMobileMenu={showMobileMenu}
          searchMode={searchMode}
          setSearchMode={setSearchMode}
          callsignInput={callsignInput}
          setCallsignInput={setCallsignInput}
          callsignSearchResult={callsignSearchResult}
          setCallsignSearchResult={setCallsignSearchResult}
          callsignError={callsignError}
          setCallsignError={setCallsignError}
          isCallsignSearching={isCallsignSearching}
          setDepartureCode={setDepartureCode}
          setDepartureAirport={setDepartureAirport}
          setArrivalCode={setArrivalCode}
          setArrivalAirport={setArrivalAirport}
          setSearchEditing={setSearchEditing}
          setDepartureTime={setDepartureTime}
          setIsPanelCollapsed={setIsPanelCollapsed}
          setIsPanelFading={setIsPanelFading}
          setShowFlightStats={setShowFlightStats}
          setIsHamburgerOpen={setIsHamburgerOpen}
          setIsMobileMenuClosing={setIsMobileMenuClosing}
          setExpandedSection={setExpandedSection}
          setShowMobileMenu={setShowMobileMenu}
          setIsMobileMenuAnimating={setIsMobileMenuAnimating}
          searchAirlines={searchAirlines}
          searchAirports={searchAirports}
          calculateFlight={calculateFlight}
          handleCallsignSearch={handleCallsignSearch}
          handleCallsignStart={handleCallsignStart}
          getAirportTimezone={getAirportTimezone}
        />

        <ShareButton
          rendererRef={rendererRef}
          sceneRef={sceneRef}
          progressTubeRef={progressTubeRef}
          transitionLabelsRef={transitionLabelsRef}
          flightLineRef={flightLineRef}
          departureAirport={departureAirport}
          arrivalAirport={arrivalAirport}
          departureCode={departureCode}
          arrivalCode={arrivalCode}
          departureTime={departureTime}
          flightResults={flightResults}
          isPanelCollapsed={isPanelCollapsed}
          isBWMode={isBWMode}
          isPlaying={isPlaying}
          isMobile={isMobile}
          getLocalTimeAtAirport={getLocalTimeAtAirport}
          getLocalDateAtAirport={getLocalDateAtAirport}
          getTimezoneAbbreviation={getTimezoneAbbreviation}
          getAirportTimezone={getAirportTimezone}
        />

        <canvas ref={canvasRef} />   
    
        <AnimationControls
            flightPath={flightPath}
            flightResults={flightResults}
            flightData={flightDataRef.current}
            animationProgress={animationProgress}
            isPlaying={isPlaying}
            showFlightStats={showFlightStats}
            departureCode={departureCode}
            arrivalCode={arrivalCode}
            callsignDisplay={searchMode === 'callsign' && callsignSearchResult ? (callsignSearchResult.summary?.flight || callsignInput).replace(/^([A-Z]{2,3})(\d.*)$/, '$1 $2') : null}
            isBWMode={isBWMode}
            onProgressChange={handleProgressChange}
            setIsPlaying={setIsPlaying}
            setIsPanelCollapsed={setIsPanelCollapsed}
            setShowFlightStats={setShowFlightStats}
            getTimezoneAbbreviation={getTimezoneAbbreviation}
            getLocalTimeAtAirport={getLocalTimeAtAirport}
            getLocalDateAtAirport={getLocalDateAtAirport}
            formatFlightTime={formatFlightTime}
          />

        <div
          ref={tooltipRef}
          style={{
            display: 'none',
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 1000,
            background: isBWMode ? BG_COLOR_BW : BG_COLOR_DARK,
            color: isBWMode ? '#1a1a1a' : '#ffffff',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em'
          }}
        />

        <Analytics />
      </div>
    )
}

export default App