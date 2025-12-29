import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import './App.css'
import SunCalc from 'suncalc'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

function App() {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return

    // 1. Create the scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe8e6e3) // warm light gray

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
    controls.minDistance = 3  // How close you can zoom
    controls.maxDistance = 10  // How far you can zoom
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

    // Add a red marker to see rotation
    const dotGeometry = new THREE.SphereGeometry(0.02, 8, 8)
    const dotMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x27A3F5,
      emissive: 0x27A3F5,
      emissiveIntensity: 1,
      roughness: 0.5,
      metalness: 0.5
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

    // Try to get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude
          const userLon = position.coords.longitude
          console.log('Your location:', userLat, userLon)
          positionDotAtLocation(userLat, userLon)
        },
        (error) => {
          console.log('Geolocation error, defaulting to Milan:', error.message)
          // Fallback to Milan if geolocation fails
          positionDotAtLocation(45.464, 9.190)
        }
      )
    } else {
      console.log('Geolocation not supported, defaulting to Milan')
      positionDotAtLocation(45.464, 9.190)
    }

    sphere.add(dot)

    // Add ambient light (soft overall illumination)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    // Add directional light (like the sun)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5)
    sunLight.position.set(5, 3, 5)
    scene.add(sunLight)

    // Create clipping plane
    // Calculate sun position for current time
    const currentTime = new Date()
    // Use a point on Earth's surface (lat/lon 0,0 = equator, prime meridian)
    const sunPos = SunCalc.getPosition(currentTime, 0, 0)

    // Convert sun position to a 3D direction vector
    // The sun's azimuth and altitude tell us where the sun is in the sky
    const sunDirection = new THREE.Vector3()
    sunDirection.x = Math.cos(sunPos.altitude) * Math.sin(sunPos.azimuth)
    sunDirection.y = Math.sin(sunPos.altitude)
    sunDirection.z = Math.cos(sunPos.altitude) * Math.cos(sunPos.azimuth)

    // The clipping plane should be perpendicular to the sun direction
    // Invert it so the dark side faces away from the sun
    const clipPlane = new THREE.Plane(sunDirection.clone().negate(), 0)

    console.log('Sun altitude:', sunPos.altitude * (180 / Math.PI), 'degrees')
    console.log('Sun azimuth:', sunPos.azimuth * (180 / Math.PI), 'degrees')
    console.log('Sun direction vector:', sunDirection)


    // Create night hemisphere
    const nightGeometry = new THREE.SphereGeometry(2.003, 64, 64)
    const nightMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,  // black instead of red
      transparent: true,
      opacity: 0.5,     // semi-transparent
      side: THREE.FrontSide,
      clippingPlanes: [clipPlane],
      clipIntersection: false
    })
    const nightSphere = new THREE.Mesh(nightGeometry, nightMaterial)
    scene.add(nightSphere)


    // 5. Animation loop
    function animate() {
      requestAnimationFrame(animate)
      
      // Rotate ONLY the Earth, not the night hemisphere
      sphere.rotation.y += 0.002
      
      // Pulsate the dot brightness
      const time = Date.now() * 0.002
      const intensity = 0.5 + Math.sin(time) * 0.5  // Oscillates between 0 and 1
      dotMaterial.emissiveIntensity = intensity
      
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

  return (
    <div className="app">
      <canvas ref={canvasRef} />
    </div>
  )
}

export default App