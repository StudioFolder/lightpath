import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import './App.css'
import SunCalc from 'suncalc'

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

    // 4. Create a sphere (our Earth)
    const geometry = new THREE.SphereGeometry(2, 64, 64)
    const material = new THREE.MeshStandardMaterial({
      color: 0x9d9d9d,
      roughness: 0.7,
      metalness: 0.1
    })
    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    // Add a red marker to see rotation
    const dotGeometry = new THREE.SphereGeometry(0.1, 16, 16)
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    const dot = new THREE.Mesh(dotGeometry, dotMaterial)
    dot.position.set(2, 0, 0)
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
    const nightGeometry = new THREE.SphereGeometry(2.02, 64, 64)
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
      sphere.rotation.y += 0.005
      
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