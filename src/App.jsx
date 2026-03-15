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
import FlightInputPanel from './components/FlightInputPanel'
import ShareButton from './components/ShareButton'
import AnimationControls from './components/AnimationControls'
import { Analytics } from '@vercel/analytics/react'

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
  const [departureAirport, setDepartureAirport] = useState(null)
  const [arrivalAirport, setArrivalAirport] = useState(null)
  const [searchEditing, setSearchEditing] = useState(0)
  const [pendingUrlFlight, setPendingUrlFlight] = useState(false)
  
  // Flight Calculation & Animation
  const [flightPath, setFlightPath] = useState(null)
  const [flightResults, setFlightResults] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [animationProgress, setAnimationProgress] = useState(0)
  const [showFlightStats, setShowFlightStats] = useState(true)
  
  // UI State
  const [showAirports, setShowAirports] = useState(true)
  const [showGraticule, setShowGraticule] = useState(true)
  const [showPlaneIcon, setShowPlaneIcon] = useState(true)
  const [showTimezones, setShowTimezones] = useState(false)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isPanelFading, setIsPanelFading] = useState(false)
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
  const [isMobile, setIsMobile] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [isMobileMenuClosing, setIsMobileMenuClosing] = useState(false)
  const [isMobileMenuAnimating, setIsMobileMenuAnimating] = useState(false)
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
  const ambientLightRef = useRef(null)
  const planeTextureRef = useRef(null)
  const planeBWTextureRef = useRef(null)
  const bwColorsRef = useRef(null)
  
  // Animation & Flight Data
  const flightDataRef = useRef(null)
  const animationProgressRef = useRef(0)
  const hasFlightPathRef = useRef(false)
  
  // Feature Toggles (synced with state)
  const autoRotateRef = useRef(true)
  const showPlaneIconRef = useRef(true)
  const isBWModeRef = useRef(false)
  const followPlaneModeRef = useRef(false)
  const isPlayingRef = useRef(false)

  // Scaling
  const viewportScaleRef = useRef(getViewportScale(window.innerWidth))
  
  // External Data & Intervals
  const timezoneDataRef = useRef(null)

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
    if (!params.route || !params.date || !params.time) return
    if (!airports) return

    const [from, to] = params.route.split('-')

    if (!airports[from] || !airports[to]) return

    const dateTime = `${params.date}T${params.time.slice(0, 2)}:${params.time.slice(2, 4)}:00`
    const flightDateTime = new Date(dateTime)

    setDepartureCode(from)
    setDepartureAirport(airports[from])
    setArrivalCode(to)
    setArrivalAirport(airports[to])
    setDepartureTime(flightDateTime)
    setPendingUrlFlight(true)
  }, [airports])

  // Auto-calculate flight once URL state is ready
  useEffect(() => {
    if (!pendingUrlFlight) return
    if (!departureCode || !arrivalCode || !departureAirport || !arrivalAirport) return

    setPendingUrlFlight(false)
    calculateFlight()
  }, [pendingUrlFlight, departureCode, arrivalCode, departureAirport, arrivalAirport])

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
    })
    .catch(err => console.error('Error loading airports:', err))

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
      '/earth-texture.png',
      () => {
        earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        checkAllLoaded()
      },
      undefined,
      (error) => console.error('Error loading texture:', error)
    )

    const material = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.9,
      metalness: 0.0
    })

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
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude
          const userLon = position.coords.longitude
          positionDotAtLocation(userLat, userLon)
          centerCameraOnLocation(userLat, userLon)
        },
        (error) => {
          positionDotAtLocation(45.464, 9.190)
          centerCameraOnLocation(45.464, 9.190)
        }
      )
    } else {
      positionDotAtLocation(45.464, 9.190)
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
            const point = curve.getPoint(transitionT)
            const eScale = flightLineRef.current?.userData.elementScale || 1.0
            const N = point.clone().normalize()
            const radialLift = N.multiplyScalar(0.03 * eScale)
            const B = label.userData.binormalDirection
            const lateralShift = B ? B.clone().multiplyScalar(0.06 * eScale) : new THREE.Vector3()
            label.position.copy(point).add(radialLift).add(lateralShift)

            const fadeProgress = (progress - transitionT) / 0.02
            label.material.opacity = Math.min(fadeProgress, 1)

            if (ring) {
              ring.visible = true
              ring.position.copy(point)
              const tangent = curve.getTangent(transitionT).normalize()
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
          const position = curve.getPoint(progress)
          
          // Get tangent (direction of travel)
          _tangent.copy(curve.getTangent(progress)).normalize()
          
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
        } else {
          planeIconRef.current.visible = false
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
        hasFlightPathRef.current = false
        transitionLabelsRef.current = []
      }

      const { departure, arrival } = flightPath

      // Create a group to hold everything
      const flightGroup = new THREE.Group()

      // Calculate great circle path using proper spherical interpolation
      const points = []
      const numPoints = 100
      const radius = 2.01

      // Get start and end points as 3D vectors
      const start = latLonToVector3(departure.lat, departure.lon, 1)
      const end = latLonToVector3(arrival.lat, arrival.lon, 1)

      // Calculate angle between vectors
      const angle = start.angleTo(end)

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

      const flightDurationMs = (flightResults.durationHours * 60 + flightResults.durationMins) * 60 * 1000

      for (let i = 0; i < numPoints; i++) {
        const fraction = (i + 0.5) / numPoints
        
        // Calculate lat/lon at this point
        const a = Math.sin((1 - fraction) * angle) / Math.sin(angle)
        const b = Math.sin(fraction * angle) / Math.sin(angle)
        
        const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
        const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
        const z = a * Math.sin(lat1) + b * Math.sin(lat2)
        
        const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
        const lon = Math.atan2(y, x) * 180 / Math.PI
        
        // Calculate time at this point
        const timeAtPoint = new Date(departureTime.getTime() + fraction * flightDurationMs)
        
        // Get sun angle (degrees from subsolar point)
        const sunAngle = getSunAngle(lat, lon, timeAtPoint)
        const inDaylight = sunAngle < 90
        
        segmentData.push({
          index: i,
          inDaylight,
          sunAngle  // Store the angle for gradient calculations
        })
      }

      // Calculate solar declination once for the entire flight
        const sunDeclination = calculateSolarDeclination(departureTime)     

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
              r = 1.00 - t * 0.10
              g = 0.40 - t * 0.35
              b = 0.00 + t * 0.40
            } else {
              r = 1.00 - t * 0.10
              g = 0.40 - t * 0.30
              b = 0.00 + t * 0.25
            }

          } else if (sunAngle < 102) {
            // NAUTICAL TWILIGHT — 96–102°
            const t = (sunAngle - 96) / 6
            if (isSunset) {
              r = 0.90 - t * 0.55
              g = 0.05
              b = 0.40 + t * 0.20
            } else {
              r = 0.90 - t * 0.45
              g = 0.10 - t * 0.05
              b = 0.25 + t * 0.15
            }

          } else if (sunAngle < 108) {
            // ASTRONOMICAL TWILIGHT
            const t = (sunAngle - 102) / 6
            r = 0.35 - t * 0.32
            g = 0.05 - t * 0.03
            b = 0.55 - t * 0.38  // was 0.60 - t * 0.42, less purple

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
            const elapsedMs = t * flightDurationMs
            const hours = Math.floor(elapsedMs / 3600000)
            const minutes = Math.floor((elapsedMs % 3600000) / 60000)
            
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
          fullProgressPoints.push(flightGroup.userData.routeCurve.getPoint(i / fullNumSamples))
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
          const tPoint = transitionCurve.getPoint(trans.t)
          const tNormal = tPoint.clone().normalize()
          const tTangent = transitionCurve.getTangent(trans.t).normalize()
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
          sprite.scale.set((isMobile ? 0.22 : 0.20) * elementScale, (isMobile ? 0.08 : 0.07) * elementScale, 1)
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
      const latDiff = arrival.lat - departure.lat
      // East-west threshold: at 0.3, flights need <30% lat-vs-lon ratio to count as east-west
      const isEastWest = Math.abs(latDiff) < Math.abs(arrival.lon - departure.lon) * 0.3

      // For departure: path heads toward arrival
      // For arrival: path arrives from departure
      const departureLabelSouth = isEastWest || latDiff > 0  // path goes north → label south
      const arrivalLabelSouth = isEastWest || latDiff < 0    // path comes from north → label south

      // Create labels with offset — positioned away from the flight path
      const createLabelWithOffset = async (code, lat, lon, iconSrc, placeSouth) => {
        const label = await createTextLabel(code, iconSrc, isBWModeRef.current)
        const basePos = latLonToVector3(lat, lon, 2.05)
        const offsetLat = placeSouth ? lat - 0.5 : lat + 0.5
        const offsetPos = latLonToVector3(offsetLat, lon, 2.05)
        const offsetDistance = placeSouth ? 0.075 : 0.025
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
                color: 0xffffff,
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
                  color: 0xffffff,
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

          // Apply B&W color if in B&W mode
          if (isBWModeRef.current) {
            graticuleGroup.traverse((child) => {
              if (child.material) {
                child.material.color.setHex(0x0f0f0f)
              }
            })
          }
          
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
            const y = positions.getY(i)
            
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
        if (tooltipRef.current) tooltipRef.current.style.display = 'none'
        resetHighlight()
      }

      canvas.addEventListener('mousemove', handleMouseMove)
      canvas.addEventListener('mouseleave', handleMouseLeave)

      return () => {
        canvas.removeEventListener('mousemove', handleMouseMove)
        canvas.removeEventListener('mouseleave', handleMouseLeave)
      }
    }, [showTimezones, isMobile, isBWMode])

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
            setTimeout(() => setShowGraticule(true), 50)
          } else {
            setShowGraticule(false)
          }
        }

        // L for twilight lines toggle
        if (e.key === 'l' || e.key === 'L') {
          setShowTwilightLines(prev => !prev)
        }

      }
      
      window.addEventListener('keydown', handleKeyPress)
      
      return () => {
        window.removeEventListener('keydown', handleKeyPress)
      }

    }, [showTimezones, showGraticule])

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
      let darknessSegments = 0

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
        } else {
          darknessSegments++
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
      setIsPanelCollapsed(true)
      
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

    const getLocalDateTimeString = (date, airport) => {
      if (!airport) return ''
      
      const timezone = getAirportTimezone(airport)
      const dt = DateTime.fromJSDate(date, { zone: timezone })
      return dt.toFormat("yyyy-MM-dd'T'HH:mm")
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
      <div className={`app ${isLoading ? 'loading' : 'loaded'} ${isBWMode ? 'bw-mode' : ''} ${flightResults ? 'has-flight' : ''} ${showFlightStats ? 'stats-visible' : ''} ${showMobileMenu ? 'menu-open' : ''} ${isMobileMenuClosing ? 'menu-closing' : ''}`}>
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
              {/* <p className="mobile-menu-tagline">
                Explore how your flight moves through daylight, twilight, and darkness.
              </p> */}

              {aboutContent && (
                <div className="mobile-menu-about">
                  <ReactMarkdown components={{ a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
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
                  <ReactMarkdown components={{ a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{dataContent}</ReactMarkdown>
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
          {/* <p 
            className="nav-tagline"
            onMouseMove={(e) => {
              const spans = e.currentTarget.querySelectorAll('.tagline-word')
              spans.forEach(span => {
                const rect = span.getBoundingClientRect()
                span.style.setProperty('--torch-x', `${e.clientX - rect.left}px`)
                span.style.setProperty('--torch-y', `${e.clientY - rect.top}px`)
              })
            }}
            onMouseLeave={(e) => {
              const spans = e.currentTarget.querySelectorAll('.tagline-word')
              spans.forEach(span => {
                span.style.setProperty('--torch-x', `-200px`)
                span.style.setProperty('--torch-y', `-200px`)
              })
            }}
          >
            Explore how your flight moves through <span className="tagline-word tagline-daylight">daylight</span>, <span className="tagline-word tagline-twilight">twilight</span>, and <span className="tagline-word tagline-darkness">darkness</span>.
          </p> */}

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
              <ReactMarkdown components={{ a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
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
              <ReactMarkdown components={{ a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{dataContent}</ReactMarkdown>
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

        <div 
          className="bw-toggle-overlay"
          style={isMobile ? { opacity: isPlaying || showMobileMenu ? 0 : 1, pointerEvents: isPlaying || showMobileMenu ? 'none' : 'all', transition: 'opacity 0.3s ease' } : {}}
        >
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

        <div 
          className="follow-toggle-overlay"
          style={isMobile ? { opacity: isPlaying || showMobileMenu ? 0 : 1, pointerEvents: isPlaying || showMobileMenu ? 'none' : 'all', transition: 'opacity 0.3s ease' } : {}}
        >
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
          isPanelCollapsed={isPanelCollapsed}
          isPanelFading={isPanelFading}
          isBWMode={isBWMode}
          isMobile={isMobile}
          isPlaying={isPlaying}
          showMobileMenu={showMobileMenu}
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
          searchAirports={searchAirports}
          calculateFlight={calculateFlight}
          getLocalDateTimeString={getLocalDateTimeString}
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
    
        {flightResults && (
          <AnimationControls
            flightPath={flightPath}
            flightResults={flightResults}
            flightData={flightDataRef.current}
            animationProgress={animationProgress}
            isPlaying={isPlaying}
            showFlightStats={showFlightStats}
            departureCode={departureCode}
            arrivalCode={arrivalCode}
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
        )}
        
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