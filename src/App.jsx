import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './App.css'
import SunCalc from 'suncalc'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import tzlookup from 'tz-lookup'
import { DateTime } from 'luxon'

function App() {
  const canvasRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [simulatedTime, setSimulatedTime] = useState(new Date())
  const [departureTime, setDepartureTime] = useState(new Date())
  const [departureCode, setDepartureCode] = useState('')
  const [arrivalCode, setArrivalCode] = useState('')
  const [airports, setAirports] = useState(null)
  const [flightPath, setFlightPath] = useState(null)
  const [flightResults, setFlightResults] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [animationProgress, setAnimationProgress] = useState(0) // 0 to 1
  const [showAirports, setShowAirports] = useState(false)
  const [showGraticule, setShowGraticule] = useState(false)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  
  // Store scene reference to add/remove flight path
  const sceneRef = useRef(null)
  const flightLineRef = useRef(null)
  const flightDataRef = useRef(null)
  const animationProgressRef = useRef(0) 
  const hasFlightPathRef = useRef(false)
  const progressTubeRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return

    // Load airport data from OpenFlights
    fetch('https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat')
    .then(res => res.text())
    .then(data => {
      // Parse CSV format
      const lines = data.split('\n')
      const airportMap = {}
      
      lines.forEach(line => {
        const parts = line.split(',').map(s => s.replace(/"/g, ''))
        if (parts.length >= 8) {
          const iata = parts[4]  // IATA code
          const name = parts[1]
          const city = parts[2]
          const lat = parseFloat(parts[6])
          const lon = parseFloat(parts[7])
          
          // Only include airports with valid IATA codes
          if (iata && iata !== '\\N' && iata.length === 3) {
            airportMap[iata] = { name, city, lat, lon }
          }
        }
      })
      
      setAirports(airportMap)
      console.log('Loaded airports:', Object.keys(airportMap).length)
    })
    .catch(err => console.error('Error loading airports:', err))

    // 1. Create the scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x606569) // warm light gray
    sceneRef.current = scene  // Store scene reference

    // 2. Create the camera
    const camera = new THREE.PerspectiveCamera(
      75,  // field of view
      window.innerWidth / window.innerHeight,  // aspect ratio
      0.1,  // near clipping plane
      1000  // far clipping plane
    )
    camera.position.z = 5  // move camera back so we can see the sphere

    // 3. Create the renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true  // smooth edges
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.localClippingEnabled = true  // Enable clipping

    // Add orbit controls for mouse interaction
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true  // Smooth motion
    controls.dampingFactor = 0.05
    controls.minDistance = 3.5  // How close you can zoom
    controls.maxDistance = 3.5  // How far you can zoom
    controls.enablePan = false  // Disable panning

    // 4. Create a sphere (our Earth)
    const geometry = new THREE.SphereGeometry(2, 64, 64)

    // Load simplified Earth texture
    const textureLoader = new THREE.TextureLoader()
    const earthTexture = textureLoader.load(
      '/earth-texture.png',  // Your custom texture
      () => console.log('Earth texture loaded'),
      undefined,
      (error) => console.error('Error loading texture:', error)
    )

    const material = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.9,
      metalness: 0.0
    })

    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    // Add atmospheric glow
    const glowGeometry = new THREE.SphereGeometry(2.15, 64, 64)
    const glowMaterial = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0) * intensity;
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true
    })
    const atmosphereGlow = new THREE.Mesh(glowGeometry, glowMaterial)
    scene.add(atmosphereGlow)

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
      const phi = (90 - lat) * (Math.PI / 180)
      const theta = (lon + 180) * (Math.PI / 180)
      const radius = 2
      
      dot.position.x = -radius * Math.sin(phi) * Math.cos(theta)
      dot.position.y = radius * Math.cos(phi)
      dot.position.z = radius * Math.sin(phi) * Math.sin(theta)
    }

    // Function to point camera at a location
    function centerCameraOnLocation(lat, lon) {
      const phi = (90 - lat) * (Math.PI / 180)
      const theta = (lon + 180) * (Math.PI / 180)
      const radius = 5  // Camera distance (same as initial position.z)
      
      camera.position.x = -radius * Math.sin(phi) * Math.cos(theta)
      camera.position.y = radius * Math.cos(phi)
      camera.position.z = radius * Math.sin(phi) * Math.sin(theta)
      
      camera.lookAt(0, 0, 0)
      controls.update()
    }

    // Try to get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude
          const userLon = position.coords.longitude
          console.log('Your location:', userLat, userLon)
          positionDotAtLocation(userLat, userLon)
          centerCameraOnLocation(userLat, userLon)  // Add this line
        },
        (error) => {
          console.log('Geolocation error, defaulting to Milan:', error.message)
          positionDotAtLocation(45.464, 9.190)
          centerCameraOnLocation(45.464, 9.190)  // Add this line
        }
      )
    } else {
      console.log('Geolocation not supported, defaulting to Milan')
      positionDotAtLocation(45.464, 9.190)
      centerCameraOnLocation(45.464, 9.190)  // Add this line
    }

    sphere.add(dot)

    // Calculate initial sun position
    const initialTime = new Date()
    
    // Get subsolar point (where sun is directly overhead)
    const times = SunCalc.getTimes(initialTime, 0, 0)
    const solarNoon = times.solarNoon
    const hoursSinceNoon = (initialTime - solarNoon) / (1000 * 60 * 60)
    const subsolarLongitude = -hoursSinceNoon * 15 // 15° per hour westward

    // Solar declination (latitude where sun is overhead)
    const dayOfYear = Math.floor((initialTime - new Date(initialTime.getFullYear(), 0, 0)) / 86400000)
    const subsolarLatitude = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))

    // Convert subsolar point to 3D direction
    const phi = (90 - subsolarLatitude) * (Math.PI / 180)
    const theta = (subsolarLongitude + 180) * (Math.PI / 180)

    const sunDirection = new THREE.Vector3(
      -Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    )

    console.log('Initial subsolar point:', subsolarLatitude.toFixed(2), '°N,', subsolarLongitude.toFixed(2), '°E')

    // Add ambient light (soft overall illumination)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3)
    scene.add(ambientLight)

    // Add directional light positioned as the sun
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2)
    sunLight.position.copy(sunDirection.clone().multiplyScalar(10))
    scene.add(sunLight)

    // Create twilight gradient overlay with custom shader
    const twilightGeometry = new THREE.SphereGeometry(2.003, 128, 128)
    const twilightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: sunDirection.clone().normalize() }
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
        varying vec3 vWorldNormal;
        
        void main() {
          // Calculate angle between surface normal and sun direction in world space
          vec3 normal = normalize(vWorldNormal);
          float sunAngle = dot(normal, sunDirection);
          
          // Convert to degrees (approximately)
          float angleDeg = acos(clamp(sunAngle, -1.0, 1.0)) * 180.0 / 3.14159;
          
          // Define transition range
          float transitionStart = 82.0;
          float transitionEnd = 98.0;

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
            // Use smooth interpolation
            darkness = smoothstep(0.0, 1.0, t);
            darkness = pow(darkness, 1.5); // Adjust curve for more natural falloff
          }
          
          // Output black with calculated opacity
          gl_FragColor = vec4(0.0, 0.0, 0.0, darkness * 0.65);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false
    })

    const twilightSphere = new THREE.Mesh(twilightGeometry, twilightMaterial)
    scene.add(twilightSphere)

    // Store references for updating
    const sceneRefs = {
      sunLight,
      twilightMaterial
    }

    // Store the start time when the app loads
    const startTime = Date.now()

    function updateSunPosition() {
      // Calculate elapsed time since start
      const elapsed = Date.now() - startTime
      
      // Real-time (1x speed)
      const acceleratedTime = startTime + (elapsed * 1)
      const currentTime = new Date(acceleratedTime)
      
      // Get subsolar point
      const times = SunCalc.getTimes(currentTime, 0, 0)
      const solarNoon = times.solarNoon
      const hoursSinceNoon = (currentTime - solarNoon) / (1000 * 60 * 60)
      const subsolarLongitude = -hoursSinceNoon * 15

      // Solar declination
      const dayOfYear = Math.floor((currentTime - new Date(currentTime.getFullYear(), 0, 0)) / 86400000)
      const subsolarLatitude = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))

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
    }

    function updateSunPositionForTime(time) {
      // Get subsolar point for specific time
      const times = SunCalc.getTimes(time, 0, 0)
      const solarNoon = times.solarNoon
      const hoursSinceNoon = (time - solarNoon) / (1000 * 60 * 60)
      const subsolarLongitude = -hoursSinceNoon * 15
    
      // Solar declination
      const dayOfYear = Math.floor((time - new Date(time.getFullYear(), 0, 0)) / 86400000)
      const subsolarLatitude = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))
    
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
    }

    // 5. Animation loop
    function animate() {
      requestAnimationFrame(animate)
      
      // Pulsate the dot brightness
      const time = Date.now() * 0.002
      const intensity = 0.5 + Math.sin(time) * 0.5
      dotMaterial.emissiveIntensity = intensity

      // Update sun position based on animation progress if flight is active
      if (flightDataRef.current && hasFlightPathRef.current) {
        const { departureTime, flightDurationMs } = flightDataRef.current
        const currentFlightTime = new Date(departureTime.getTime() + animationProgressRef.current * flightDurationMs)
        
        // Update both display time and sun position to animation time
        setCurrentTime(new Date())
        setSimulatedTime(currentFlightTime)
        updateSunPositionForTime(currentFlightTime)
      } else {
        // Normal real-time mode when no flight is active
        setCurrentTime(new Date())
        const elapsed = Date.now() - startTime
        const acceleratedTime = startTime + (elapsed * 1)
        setSimulatedTime(new Date(acceleratedTime))
        updateSunPosition()
      }

      // Update flight path progress visualization
      if (hasFlightPathRef.current && flightLineRef.current && flightLineRef.current.userData.routeCurve) {
        const progress = animationProgressRef.current
        
        // Remove old progress tube if exists
        if (progressTubeRef.current) {
          flightLineRef.current.remove(progressTubeRef.current)
          
          // Properly dispose based on whether it's a Group or Mesh
          progressTubeRef.current.traverse((child) => {
            if (child.geometry) child.geometry.dispose()
            if (child.material) child.material.dispose()
          })
          
          progressTubeRef.current = null
        }
        
        if (progress > 0) {
          // Get points for completed portion
          const curve = flightLineRef.current.userData.routeCurve
          const segmentData = flightLineRef.current.userData.segmentData
          const completedPoints = []
          const numSamples = 100
          
          for (let i = 0; i <= numSamples; i++) {
            const t = (i / numSamples) * progress
            completedPoints.push(curve.getPoint(t))
          }
          
          if (completedPoints.length > 1) {
            // Determine color based on sun angle (twilight-aware)
            const colors = []

            for (let i = 0; i < completedPoints.length; i++) {
              const segmentIndex = Math.min(
                Math.floor((i / completedPoints.length) * progress * segmentData.length),
                segmentData.length - 1
              )
              const segmentInfo = segmentData[segmentIndex]
              
              if (!segmentInfo) {
                colors.push(1, 1, 1) // White fallback
                continue
              }
              
              const sunAngle = segmentInfo.sunAngle
              
              // Color based on sun angle
              // 0-85°: Full day (gold)
              // 85-95°: Twilight (gold to light blue gradient)
              // 95-105°: Deep twilight (light blue to deep blue)
              // 105+: Night (deep blue)
              
              let r, g, b
              
              if (sunAngle < 85) {
                // Full daylight - gold
                r = 1
                g = 0.84
                b = 0
              } else if (sunAngle < 95) {
                // Twilight transition - gold to orange to light blue
                const t = (sunAngle - 85) / 10
                r = 1 - t * 0.4  // 1.0 -> 0.6
                g = 0.84 - t * 0.2  // 0.84 -> 0.64
                b = t * 0.8  // 0 -> 0.8
              } else if (sunAngle < 105) {
                // Deep twilight - light blue to blue
                const t = (sunAngle - 95) / 10
                r = 0.6 - t * 0.21  // 0.6 -> 0.39
                g = 0.64 - t * 0.06  // 0.64 -> 0.58
                b = 0.8 + t * 0.13  // 0.8 -> 0.93
              } else {
                // Night - cornflower blue
                r = 0.39
                g = 0.58
                b = 0.93
              }
              
              colors.push(r, g, b)
            }
            
            // Create single tube with vertex colors
            const thickGeometry = new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(completedPoints),
              completedPoints.length - 1,
              0.006,
              8,
              false
            )
            
            // Apply vertex colors
            const colorArray = new Float32Array(colors.length * thickGeometry.attributes.position.count / completedPoints.length)
            for (let i = 0; i < thickGeometry.attributes.position.count; i++) {
              const pointIndex = Math.floor(i / (thickGeometry.attributes.position.count / completedPoints.length))
              const colorIndex = Math.min(pointIndex * 3, colors.length - 3)
              colorArray[i * 3] = colors[colorIndex]
              colorArray[i * 3 + 1] = colors[colorIndex + 1]
              colorArray[i * 3 + 2] = colors[colorIndex + 2]
            }
            
            thickGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3))
            
            const thickMaterial = new THREE.MeshBasicMaterial({ 
              vertexColors: true
            })
            const thickTube = new THREE.Mesh(thickGeometry, thickMaterial)
            
            flightLineRef.current.add(thickTube)
            progressTubeRef.current = thickTube
          }
        }
      }

      // Keep location dot constant size
      const currentDistance = camera.position.length()
      const baseDistance = 5  // Initial camera distance
      const dotScale = currentDistance / baseDistance
      dot.scale.setScalar(dotScale)
      
      controls.update()
      renderer.render(scene, camera)
    }
    
    animate()

    // 6. Handle window resize
    function handleResize() {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    
    window.addEventListener('resize', handleResize)

    // 7. Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
    }
  }, [])

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
        hasFlightPathRef.current = false  // Add this
      }

      const { departure, arrival } = flightPath

      // Create a group to hold everything
      const flightGroup = new THREE.Group()

      // Helper function to convert lat/lon to 3D vector
      const latLonToVector3 = (lat, lon, radius) => {
        const phi = (90 - lat) * (Math.PI / 180)
        const theta = (lon + 180) * (Math.PI / 180)
        
        return new THREE.Vector3(
          -radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        )
      }

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

      // Helper to calculate sun angle at a point
      const getSunAngle = (lat, lon, time) => {
        const times = SunCalc.getTimes(time, 0, 0)
        const solarNoon = times.solarNoon
        const hoursSinceNoon = (time - solarNoon) / (1000 * 60 * 60)
        const subsolarLongitude = -hoursSinceNoon * 15

        const dayOfYear = Math.floor((time - new Date(time.getFullYear(), 0, 0)) / 86400000)
        const subsolarLatitude = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))

        // Calculate angular distance from subsolar point
        const lat1 = subsolarLatitude * Math.PI / 180
        const lon1 = subsolarLongitude * Math.PI / 180
        const lat2 = lat * Math.PI / 180
        const lon2 = lon * Math.PI / 180

        const angularDistance = Math.acos(
          Math.sin(lat1) * Math.sin(lat2) + 
          Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
        ) * 180 / Math.PI

        return angularDistance
      }

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

        // Create the thin gray base path
        const thinTubeGeometry = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          points.length,
          0.002,
          8,
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
        flightGroup.userData.routePoints = points
        flightGroup.userData.routeCurve = new THREE.CatmullRomCurve3(points)
        flightGroup.userData.segmentData = segmentData

      // Add airport markers (dots)
      const dotGeometry = new THREE.SphereGeometry(0.01, 16, 16)
      const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xe0e0e0 })
      
      const departureDot = new THREE.Mesh(dotGeometry, dotMaterial)
      departureDot.position.copy(latLonToVector3(departure.lat, departure.lon, 2.01))
      flightGroup.add(departureDot)
      
      const arrivalDot = new THREE.Mesh(dotGeometry, dotMaterial)
      arrivalDot.position.copy(latLonToVector3(arrival.lat, arrival.lon, 2.01))
      flightGroup.add(arrivalDot)

      // Add text labels using canvas textures
      const createTextLabel = (text) => {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        canvas.width = 256
        canvas.height = 128
        
        context.fillStyle = 'rgba(255, 255, 255, 0)'
        context.fillRect(0, 0, canvas.width, canvas.height)
        
        context.fillStyle = '#ffffff'
        context.font = '48px system-ui, -apple-system, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(text, canvas.width / 2, canvas.height / 2)
        
        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ 
          map: texture,
          sizeAttenuation: false
        })
        const sprite = new THREE.Sprite(material)
        sprite.scale.set(0.1, 0.05, 1)
        
        return sprite
      }

      // Create labels with offset
      const createLabelWithOffset = (code, lat, lon) => {
        const label = createTextLabel(code)
        
        // Position at airport location
        const basePos = latLonToVector3(lat, lon, 2.05)
        
        // Calculate "down" offset (toward south pole from this point)
        const offsetLat = lat - 2 // Move 3 degrees south
        const offsetPos = latLonToVector3(offsetLat, lon, 2.05)
        
        // Offset is the difference
        const offset = offsetPos.clone().sub(basePos).normalize().multiplyScalar(0.08)
        
        label.position.copy(basePos.add(offset))
        return label
      }

      const departureLabel = createLabelWithOffset(departureCode, departure.lat, departure.lon)
      flightGroup.add(departureLabel)

      const arrivalLabel = createLabelWithOffset(arrivalCode, arrival.lat, arrival.lon)
      flightGroup.add(arrivalLabel)

      sceneRef.current.add(flightGroup)
      flightLineRef.current = flightGroup
      hasFlightPathRef.current = true

      console.log('Flight path with markers drawn')
    }, [flightPath, flightResults, departureTime, departureCode, arrivalCode])

    // Effect to show/hide all airports
    useEffect(() => {
      if (!sceneRef.current || !airports) return

      let fadeInterval = null
      
      // Remove existing airport dots with fade out
      const existingDots = sceneRef.current.getObjectByName('airportDots')
      if (existingDots) {
        const material = existingDots.material
        let opacity = material.opacity
        
        const fadeOut = setInterval(() => {
          opacity -= 0.02
          if (opacity <= 0) {
            opacity = 0
            clearInterval(fadeOut)
            sceneRef.current.remove(existingDots)
            existingDots.geometry.dispose()
            material.dispose()
          } else {
            material.opacity = opacity
          }
        }, 20)
      }
      
      if (!showAirports) return
      
      // Create points for all airports
      const positions = []
      const airportList = Object.values(airports)
      
      airportList.forEach(airport => {
        const phi = (90 - airport.lat) * (Math.PI / 180)
        const theta = (airport.lon + 180) * (Math.PI / 180)
        const radius = 2.005 // Slightly above Earth surface
        
        const x = -radius * Math.sin(phi) * Math.cos(theta)
        const y = radius * Math.cos(phi)
        const z = radius * Math.sin(phi) * Math.sin(theta)
        
        positions.push(x, y, z)
      })
      
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      
      const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.004,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0  // Start invisible
      })
      
      const points = new THREE.Points(geometry, material)
      points.name = 'airportDots'
      sceneRef.current.add(points)

      // Fade in animation
      let opacity = 0
      const fadeIn = setInterval(() => {
        opacity += 0.02
        if (opacity >= 0.6) {
          opacity = 0.6
          clearInterval(fadeIn)
        }
        material.opacity = opacity
      }, 20) // Update every 20ms
      
      console.log('Rendered', airportList.length, 'airports')
      return () => {
        if (fadeInterval) clearInterval(fadeInterval)
      }
    }, [showAirports, airports])

    // Effect to show/hide graticule
    useEffect(() => {
      if (!sceneRef.current) return
      
      let fadeInterval = null
      
      // Remove existing graticule if exists
      const existingGraticule = sceneRef.current.getObjectByName('graticule')
      if (existingGraticule) {
        let opacity = 0.2 // Start from current opacity
        
        const fadeOut = setInterval(() => {
          opacity -= 0.02
          if (opacity <= 0) {
            clearInterval(fadeOut)
            sceneRef.current.remove(existingGraticule)
            existingGraticule.traverse((child) => {
              if (child.geometry) child.geometry.dispose()
              if (child.material) child.material.dispose()
            })
          } else {
            // Update all child materials
            existingGraticule.traverse((child) => {
              if (child.material) {
                child.material.opacity = opacity
              }
            })
          }
        }, 20)
      }
      
      if (!showGraticule) return
      
      // Load and render graticule
      fetch('/graticule-10.geojson')
        .then(res => res.json())
        .then(data => {
          const graticuleGroup = new THREE.Group()
          graticuleGroup.name = 'graticule'
          
          // Convert lat/lon to 3D
          const latLonToVector3 = (lon, lat, radius) => {
            const phi = (90 - lat) * (Math.PI / 180)
            const theta = (lon + 180) * (Math.PI / 180)
            
            return new THREE.Vector3(
              -radius * Math.sin(phi) * Math.cos(theta),
              radius * Math.cos(phi),
              radius * Math.sin(phi) * Math.sin(theta)
            )
          }
          
          // Process each feature (line)
          data.features.forEach(feature => {
            if (feature.geometry.type === 'LineString') {
              const coords = feature.geometry.coordinates
              const points = coords.map(coord => 
                latLonToVector3(coord[0], coord[1], 2.004)
              )
              
              const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
              const lineMaterial = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0 // Start invisible for fade-in
              })
              
              const line = new THREE.Line(lineGeometry, lineMaterial)
              graticuleGroup.add(line)
            } else if (feature.geometry.type === 'MultiLineString') {
              feature.geometry.coordinates.forEach(lineCoords => {
                const points = lineCoords.map(coord => 
                  latLonToVector3(coord[0], coord[1], 2.004)
                )
                
                const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
                const lineMaterial = new THREE.LineBasicMaterial({
                  color: 0xffffff,
                  transparent: true,
                  opacity: 0
                })
                
                const line = new THREE.Line(lineGeometry, lineMaterial)
                graticuleGroup.add(line)
              })
            }
          })
          
          sceneRef.current.add(graticuleGroup)
          
          // Fade in
          let opacity = 0
          fadeInterval = setInterval(() => {
            opacity += 0.02
            if (opacity >= 0.2) {
              opacity = 0.2
              clearInterval(fadeInterval)
            }
            graticuleGroup.traverse((child) => {
              if (child.material) {
                child.material.opacity = opacity
              }
            })
          }, 20)
          
          console.log('Graticule loaded with', data.features.length, 'features')
        })
        .catch(err => console.error('Error loading graticule:', err))
      
      return () => {
        if (fadeInterval) clearInterval(fadeInterval)
      }
    }, [showGraticule])

    useEffect(() => {
      if (!isPlaying || !flightDataRef.current) return
      
      // Get flight distance in km from flightResults
      const flightDistanceKm = flightResults ? parseFloat(flightResults.distance) : 5000
      
      // Define speed in km per second of animation
      const kmPerSecond = 500 // Adjust this! Higher = faster line movement
      
      // Calculate total animation duration based on distance
      const animationDurationMs = (flightDistanceKm / kmPerSecond) * 1000
      
      const updateInterval = 50
      const increment = updateInterval / animationDurationMs
      
      const interval = setInterval(() => {
        setAnimationProgress(prev => {
          const newProgress = Math.min(prev + increment, 1.0)  // Clamp to exactly 1.0
          animationProgressRef.current = newProgress
          if (newProgress >= 1) {
            setIsPlaying(false)
          }
          return newProgress
        })
      }, updateInterval)
      
      return () => clearInterval(interval)
    }, [isPlaying, flightResults])

    const isPointInDaylight = (lat, lon, time) => {
      // Get subsolar point at this time
      const times = SunCalc.getTimes(time, 0, 0)
      const solarNoon = times.solarNoon
      const hoursSinceNoon = (time - solarNoon) / (1000 * 60 * 60)
      const subsolarLongitude = -hoursSinceNoon * 15
    
      const dayOfYear = Math.floor((time - new Date(time.getFullYear(), 0, 0)) / 86400000)
      const subsolarLatitude = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))
    
      // Calculate angular distance from subsolar point
      const lat1 = subsolarLatitude * Math.PI / 180
      const lon1 = subsolarLongitude * Math.PI / 180
      const lat2 = lat * Math.PI / 180
      const lon2 = lon * Math.PI / 180
    
      const angularDistance = Math.acos(
        Math.sin(lat1) * Math.sin(lat2) + 
        Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
      ) * 180 / Math.PI
    
      // Point is in daylight if within ~90 degrees of subsolar point
      return angularDistance < 90
    }

    const calculateFlight = () => {
      if (!airports) {
        console.log('Airports not loaded yet')
        return
      }
      
      const departure = airports[departureCode]
      const arrival = airports[arrivalCode]
      
      if (!departure) {
        console.log('Departure airport not found:', departureCode)
        return
      }
      
      if (!arrival) {
        console.log('Arrival airport not found:', arrivalCode)
        return
      }
      
      console.log('Flight from', departure.city, 'to', arrival.city)
      
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
      
      // Estimate flight duration (average cruise speed ~850 km/h)
      const cruiseSpeed = 750 // km/h
      const flightDurationHours = distance / cruiseSpeed
      const flightDurationMs = flightDurationHours * 60 * 60 * 1000
      
      console.log('Distance:', distance.toFixed(0), 'km')
      console.log('Estimated duration:', flightDurationHours.toFixed(2), 'hours')
      
      // Sample points along the route and check daylight
      const numSamples = 100
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
        distance: distance.toFixed(0),
        duration: flightDurationHours.toFixed(1),
        durationHours: totalDurationHours,
        durationMins: totalDurationMins,
        daylightHours,
        daylightMins,
        darknessHours,
        darknessMins
      }
      
      console.log('Results:', results)
      setFlightResults(results)
      
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
      
    }

    const getAirportTimezone = (airport) => {
      try {
        const tz = tzlookup(airport.lat, airport.lon)
        return tz
      } catch (e) {
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
      return `${hours}h ${mins}m elapsed`
    }

    return (
      <div className="app">
        <div className="info-overlay">
          <div className="time">{simulatedTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="date">{simulatedTime.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
        </div>

        <div className="info-overlay">
          <div className="time">{simulatedTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="date">{simulatedTime.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
        </div>

        <div className="airport-toggle-overlay">
          <label>
            <input 
              type="checkbox"
              checked={showAirports}
              onChange={(e) => setShowAirports(e.target.checked)}
            />
            <span>Show all airports</span>
          </label>
        </div>

        <div className="graticule-toggle-overlay">
          <label>
            <input 
              type="checkbox"
              checked={showGraticule}
              onChange={(e) => setShowGraticule(e.target.checked)}
            />
            <span>Show graticule</span>
          </label>
        </div>
        
        <div className={`flight-input ${isPanelCollapsed ? 'collapsed' : ''}`}>
          <div className="panel-header">
            <h3>Flight Path</h3>
            <button 
              className="collapse-button"
              onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
              aria-label={isPanelCollapsed ? "Expand panel" : "Collapse panel"}
            >
              {isPanelCollapsed ? '▼' : '▲'}
            </button>
          </div>
          
          <div className="panel-content">
            <div className="input-group">
              <label>Departure</label>
              <input 
                type="text" 
                maxLength="3"
                value={departureCode}
                onChange={(e) => setDepartureCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="input-group">
              <label>Arrival</label>
              <input 
                type="text" 
                maxLength="3"
                value={arrivalCode}
                onChange={(e) => setArrivalCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="datetime-group">
              <label>Departure Time (Local)</label>
              <input 
                type="datetime-local"
                value={departureTime.toISOString().slice(0, 16)}
                onChange={(e) => setDepartureTime(new Date(e.target.value))}
              />
            </div>
            <button 
              onClick={calculateFlight}
              disabled={!airports || departureCode.length !== 3 || arrivalCode.length !== 3}
            >
              {!airports ? 'Loading airports...' : 'Calculate Flight'}
            </button>
            
            {flightResults && (
              <div className="results-panel">
                <div className="result-row">
                  <span className="result-label">Distance:</span>
                  <span className="result-value">{flightResults.distance} km</span>
                </div>
                <div className="result-row">
                  <span className="result-label">Duration:</span>
                  <span className="result-value">{flightResults.durationHours}h {flightResults.durationMins}m</span>
                </div>
                <div className="result-row">
                  <span className="result-label">Daylight:</span>
                  <span className="result-value">{flightResults.daylightHours}h {flightResults.daylightMins}m</span>
                </div>
                <div className="result-row">
                  <span className="result-label">Darkness:</span>
                  <span className="result-value">{flightResults.darknessHours}h {flightResults.darknessMins}m</span>
                </div>
              </div>
            )}
    
          </div>
        </div>
        
        <canvas ref={canvasRef} />
    
        {flightResults && (
          <div className={`animation-controls ${flightPath ? 'visible' : ''}`}>
            <div className="animation-header">
              <div className="airport-time airport-time-left">
                <span className="airport-code">
                  {flightDataRef.current && getTimezoneAbbreviation(flightDataRef.current.departure)}
                </span>
                <span className="time-value">
                  {flightDataRef.current && getLocalTimeAtAirport(
                    new Date(flightDataRef.current.departureTime.getTime() + animationProgress * flightDataRef.current.flightDurationMs),
                    flightDataRef.current.departure
                  )}
                </span>
              </div>
    
              <div className="flight-info-center">
                <div className="animation-route">
                  {departureCode} → {arrivalCode}
                </div>
                <div className="animation-time">
                  {formatFlightTime(animationProgress, flightResults)}
                </div>
              </div>
    
              <div className="airport-time airport-time-right">
                <span className="airport-code">
                  {flightDataRef.current && getTimezoneAbbreviation(flightDataRef.current.arrival)}
                </span>
                <span className="time-value">
                  {flightDataRef.current && getLocalTimeAtAirport(
                    new Date(flightDataRef.current.departureTime.getTime() + animationProgress * flightDataRef.current.flightDurationMs),
                    flightDataRef.current.arrival
                  )}
                </span>
              </div>
            </div>
            
            <div className="slider-container">
              <input
                type="range"
                min="0"
                max="1000"
                value={animationProgress * 1000}
                onChange={(e) => {
                  const newProgress = e.target.value / 1000
                  setAnimationProgress(newProgress)
                  animationProgressRef.current = newProgress
                }}
                className="time-slider"
              />
              <div className="time-labels">
                <span>Departure</span>
                <span>Arrival</span>
              </div>
            </div>
            
            <button 
              className="play-button"
              onClick={() => {
                if (animationProgress >= 1) {
                  // Reset to beginning if at end
                  setAnimationProgress(0)
                  animationProgressRef.current = 0
                }
                // Collapse panel when starting to play
                if (!isPlaying) {
                  setIsPanelCollapsed(true)
                }
                setIsPlaying(!isPlaying)
              }}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
          </div>
        )}
    
      </div>
    )
}

export default App