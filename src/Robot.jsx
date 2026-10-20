import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, MathUtils } from 'three'

const metal = '#a9c5d9'
const darkMetal = '#45647c'
const gold = '#e2b25a'

const ACTION_MOODS = {
  Wave: 'wave',
  Dance: 'dance',
  ThumbsUp: 'cool',
  Yes: 'happy',
  No: 'confused',
  Jump: 'surprised',
}

function drawFace(context, mood) {
  const styles = {
    idle: { glow: '#67e8f9', face: '#12334a' },
    speaking: { glow: '#f6c768', face: '#3c2d32' },
    wave: { glow: '#f6c768', face: '#3c2d32' },
    dance: { glow: '#fb8bd1', face: '#3b2444' },
    cool: { glow: '#85e7f4', face: '#173b52' },
    happy: { glow: '#84f0ba', face: '#183e3d' },
    confused: { glow: '#c2a6ff', face: '#322c4b' },
    surprised: { glow: '#ff987b', face: '#482d35' },
  }
  const { glow, face } = styles[mood] || styles.idle
  const line = (points, color = glow, width = 8) => {
    context.beginPath()
    context.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i += 1) {
      context.lineTo(points[i][0], points[i][1])
    }
    context.strokeStyle = color
    context.lineWidth = width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()
  }
  const eye = (x, y, width, height, color = glow) => {
    context.beginPath()
    context.ellipse(x, y, width, height, 0, 0, Math.PI * 2)
    context.fillStyle = color
    context.fill()
  }

  context.clearRect(0, 0, 256, 192)
  context.save()
  context.shadowColor = glow
  context.shadowBlur = 14
  context.beginPath()
  context.arc(128, 96, 75, 0, Math.PI * 2)
  context.fillStyle = face
  context.fill()
  context.lineWidth = 5
  context.strokeStyle = glow
  context.stroke()
  context.restore()

  if (mood === 'cool') {
    context.fillStyle = glow
    context.fillRect(75, 73, 48, 20)
    context.fillRect(133, 73, 48, 20)
    line([[123, 81], [133, 81]], '#e7fbff', 5)
    line([[91, 127], [108, 134], [128, 136], [148, 134], [165, 127]], '#e7fbff', 7)
    return
  }

  if (mood === 'surprised') {
    eye(98, 79, 10, 15)
    eye(158, 79, 10, 15)
    context.beginPath()
    context.ellipse(128, 126, 13, 19, 0, 0, Math.PI * 2)
    context.fillStyle = glow
    context.fill()
    context.beginPath()
    context.ellipse(128, 126, 6, 11, 0, 0, Math.PI * 2)
    context.fillStyle = face
    context.fill()
    return
  }

  if (mood === 'confused') {
    line([[82, 62], [106, 55], [119, 61]], '#e7fbff', 6)
    line([[142, 59], [158, 55], [176, 61]], '#e7fbff', 6)
    eye(100, 82, 8, 11)
    eye(158, 82, 8, 11)
    line([[108, 130], [122, 124], [139, 127], [151, 122]], '#e7fbff', 7)
    return
  }

  if (mood === 'wave') {
    line([[84, 82], [96, 69], [108, 82]], '#e7fbff', 7)
    eye(158, 78, 9, 12)
    line([[103, 126], [117, 137], [136, 138], [153, 126]], '#e7fbff', 7)
    return
  }

  if (mood === 'dance') {
    line([[84, 79], [98, 67], [112, 79]], '#e7fbff', 7)
    line([[144, 79], [158, 67], [172, 79]], '#e7fbff', 7)
    context.beginPath()
    context.ellipse(128, 126, 29, 19, 0, 0, Math.PI * 2)
    context.fillStyle = glow
    context.fill()
    context.fillStyle = '#fff0fa'
    context.fillRect(109, 110, 38, 8)
    return
  }

  if (mood === 'speaking') {
    eye(98, 78, 10, 13)
    eye(158, 78, 10, 13)
    context.beginPath()
    context.ellipse(128, 126, 20, 17, 0, 0, Math.PI * 2)
    context.fillStyle = glow
    context.fill()
    context.beginPath()
    context.ellipse(128, 125, 11, 9, 0, 0, Math.PI * 2)
    context.fillStyle = face
    context.fill()
    return
  }

  eye(98, 79, 9, 12)
  eye(158, 79, 9, 12)
  if (mood === 'happy') {
    line([[84, 84], [98, 72], [112, 84]], '#e7fbff', 5)
    line([[144, 84], [158, 72], [172, 84]], '#e7fbff', 5)
  }
  line([[91, 119], [108, 133], [128, 138], [148, 133], [165, 119]], '#e7fbff', 7)
}

function ChestEmoji({ mood }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 192
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not create the robot emotion display.')
    }
    drawFace(context, mood)
    return new CanvasTexture(canvas)
  }, [mood])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh position={[0, 1.72, 0.526]}>
      <planeGeometry args={[0.43, 0.34]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  )
}

function Joint({ position, radius = 0.2 }) {
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[radius, 24, 16]} />
      <meshStandardMaterial color={darkMetal} metalness={0.72} roughness={0.28} />
    </mesh>
  )
}

function Segment({ position, radius, length, color = metal }) {
  return (
    <mesh position={position} castShadow>
      <capsuleGeometry args={[radius, length, 5, 16]} />
      <meshStandardMaterial color={color} metalness={0.62} roughness={0.3} />
    </mesh>
  )
}

function Hand({ position }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <sphereGeometry args={[0.2, 20, 16]} />
        <meshStandardMaterial color={gold} metalness={0.48} roughness={0.32} />
      </mesh>
      {[-0.12, -0.04, 0.04, 0.12].map((x) => (
        <mesh key={x} position={[x, -0.17, 0]} castShadow>
          <capsuleGeometry args={[0.035, 0.13, 3, 8]} />
          <meshStandardMaterial color={gold} metalness={0.48} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[0.19, -0.02, 0]} rotation={[0, 0, -0.7]} castShadow>
        <capsuleGeometry args={[0.045, 0.13, 3, 8]} />
        <meshStandardMaterial color={gold} metalness={0.48} roughness={0.32} />
      </mesh>
    </group>
  )
}

function Arm({ side, armRef }) {
  return (
    <group ref={armRef} position={[side * 0.77, 2.12, 0]}>
      <Joint position={[0, 0, 0]} radius={0.24} />
      <Segment position={[side * 0.04, -0.39, 0]} radius={0.16} length={0.38} />
      <Joint position={[side * 0.08, -0.76, 0]} radius={0.17} />
      <Segment position={[side * 0.08, -1.03, 0]} radius={0.13} length={0.23} color={darkMetal} />
      <Hand position={[side * 0.08, -1.3, 0]} />
    </group>
  )
}

function Leg({ side, legRef }) {
  return (
    <group ref={legRef} position={[side * 0.36, 0.94, 0]}>
      <Joint position={[0, 0, 0]} radius={0.22} />
      <Segment position={[0, -0.34, 0]} radius={0.19} length={0.29} />
      <Joint position={[0, -0.68, 0]} radius={0.16} />
      <Segment position={[0, -0.88, 0]} radius={0.14} length={0.19} color={darkMetal} />
      <mesh position={[side * 0.05, -1.02, 0.13]} castShadow>
        <boxGeometry args={[0.4, 0.2, 0.58]} />
        <meshStandardMaterial color={metal} metalness={0.62} roughness={0.3} />
      </mesh>
      <mesh position={[side * 0.05, -0.91, 0.17]} castShadow>
        <boxGeometry args={[0.42, 0.07, 0.34]} />
        <meshStandardMaterial color={gold} metalness={0.45} roughness={0.34} />
      </mesh>
    </group>
  )
}

export function Robot({ getVolume = () => 0, talking = false, action = 'Idle' }) {
  const motion = useRef()
  const head = useRef()
  const mouth = useRef()
  const chestLight = useRef()
  const leftArm = useRef()
  const rightArm = useRef()
  const leftLeg = useRef()
  const rightLeg = useRef()
  const speech = useRef(0)
  const previousAction = useRef(action)
  const danceStartedAt = useRef(0)
  const mood = talking ? 'speaking' : ACTION_MOODS[action] || 'idle'

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime
    if (action !== previousAction.current) {
      if (action === 'Dance') danceStartedAt.current = time
      previousAction.current = action
    }
    const danceTime = Math.max(0, time - danceStartedAt.current)
    const danceMove = Math.floor(danceTime / 2.4) % 4
    const moveTime = danceTime % 2.4
    const volume = MathUtils.clamp(getVolume(), 0, 1)
    speech.current = MathUtils.damp(speech.current, talking ? 1 : 0, 7, delta)
    const speaking = speech.current

    if (motion.current) {
      motion.current.position.y =
        action === 'Dance'
          ? 0.06 + Math.abs(Math.sin(time * 5.2)) * 0.1
          : Math.sin(time * (action === 'Jump' ? 8 : 2.6)) *
            (action === 'Jump' ? 0.34 : 0.035 + speaking * 0.055)
      motion.current.rotation.z =
        action === 'Dance'
          ? Math.sin(time * 2.6) * 0.13
          : Math.sin(time * 3.2) * (0.018 + speaking * 0.035)
    }
    if (head.current) {
      head.current.rotation.x = Math.sin(time * 2.4) * (0.025 + speaking * 0.06)
      head.current.rotation.z =
        action === 'Dance'
          ? Math.sin(time * 5.2) * 0.13
          : Math.sin(time * 1.8) * (action === 'No' ? 0.28 : 0.025 + speaking * 0.035)
      if (action === 'Yes') head.current.rotation.x += Math.sin(time * 7) * 0.16
    }
    if (mouth.current) {
      mouth.current.scale.y = 0.045 + volume * 0.2
      mouth.current.visible = talking || volume > 0.04
    }
    if (chestLight.current) {
      chestLight.current.material.emissiveIntensity = 0.6 + speaking * (0.8 + volume)
    }

    if (rightArm.current && leftArm.current) {
      let rightZ = 0.08
      let leftZ = -0.08
      let rightX = 0
      let leftX = 0
      let rightY = 0
      let leftY = 0
      if (action === 'Wave') {
        rightZ = 2.65 + Math.sin(time * 7) * 0.18
      } else if (action === 'ThumbsUp') {
        rightZ = 2.8
      } else if (action === 'Dance') {
        const beat = Math.sin(moveTime * 4.2)
        const alternate = Math.sin(moveTime * 2.1)
        if (danceMove === 0) {
          // Tecktonik: alternate overhead arm hits with the opposite arm crossing the chest.
          rightZ = 1.35 + alternate * 1.05
          leftZ = -1.35 - alternate * 1.05
          rightX = 0.45 + beat * 0.35
          leftX = -0.45 - beat * 0.35
          rightY = beat * 0.42
          leftY = -beat * 0.42
        } else if (danceMove === 1) {
          // Tutting and popping: sharp alternating angles soften into the next move.
          rightZ = 1.85 + Math.sin(moveTime * 6) * 0.3
          leftZ = -0.55 - Math.sin(moveTime * 6 + Math.PI) * 0.3
          rightX = Math.sin(moveTime * 6) * 0.5
          leftX = Math.sin(moveTime * 6 + Math.PI) * 0.5
        } else if (danceMove === 2) {
          // Shuffle groove with both arms pumping to the beat.
          rightZ = 1.65 + beat * 0.55
          leftZ = -1.65 - beat * 0.55
          rightX = beat * 0.25
          leftX = -beat * 0.25
          rightY = Math.sin(moveTime * 4.2 + Math.PI / 2) * 0.35
          leftY = -Math.sin(moveTime * 4.2 + Math.PI / 2) * 0.35
        } else {
          // Alternating arm waves finish the loop before tecktonik starts again.
          rightZ = 0.55 + Math.sin(moveTime * 3.2) * 1.25
          leftZ = -0.55 - Math.sin(moveTime * 3.2 + Math.PI) * 1.25
          rightX = Math.sin(moveTime * 3.2 + Math.PI / 2) * 0.45
          leftX = Math.sin(moveTime * 3.2 - Math.PI / 2) * 0.45
          rightY = Math.sin(moveTime * 3.2) * 0.3
          leftY = -Math.sin(moveTime * 3.2) * 0.3
        }
      } else if (talking) {
        rightZ += Math.sin(time * 3.5) * 0.08 * speaking
      }
      rightArm.current.rotation.z = MathUtils.damp(rightArm.current.rotation.z, rightZ, 9, delta)
      leftArm.current.rotation.z = MathUtils.damp(leftArm.current.rotation.z, leftZ, 9, delta)
      rightArm.current.rotation.x = MathUtils.damp(rightArm.current.rotation.x, rightX, 9, delta)
      leftArm.current.rotation.x = MathUtils.damp(leftArm.current.rotation.x, leftX, 9, delta)
      rightArm.current.rotation.y = MathUtils.damp(rightArm.current.rotation.y, rightY, 9, delta)
      leftArm.current.rotation.y = MathUtils.damp(leftArm.current.rotation.y, leftY, 9, delta)
    }
    if (leftLeg.current && rightLeg.current) {
      const jumping = action === 'Jump'
      let leftX = 0
      let rightX = 0
      let leftZ = 0
      let rightZ = 0
      if (action === 'Dance') {
        const step = Math.sin(moveTime * 5.2)
        if (danceMove === 0) {
          leftX = step * 0.28
          rightX = -step * 0.28
          leftZ = Math.sin(moveTime * 2.1) * 0.06
          rightZ = -leftZ
        } else if (danceMove === 1) {
          leftX = Math.sin(moveTime * 6) * 0.2
          rightX = Math.sin(moveTime * 6 + Math.PI) * 0.2
          leftZ = Math.sin(moveTime * 6) * 0.14
          rightZ = -leftZ
        } else if (danceMove === 2) {
          leftX = Math.max(0, step) * 0.7
          rightX = Math.max(0, -step) * 0.7
          leftZ = Math.sin(moveTime * 5.2) * 0.09
          rightZ = -leftZ
        } else {
          leftX = step * 0.35
          rightX = -step * 0.35
          leftZ = Math.sin(moveTime * 3.2) * 0.12
          rightZ = -leftZ
        }
      }
      if (jumping) {
        leftX += Math.sin(time * 8) * 0.18
        rightX -= Math.sin(time * 8) * 0.18
      }
      leftLeg.current.rotation.x = MathUtils.damp(leftLeg.current.rotation.x, leftX, 8, delta)
      rightLeg.current.rotation.x = MathUtils.damp(rightLeg.current.rotation.x, rightX, 8, delta)
      leftLeg.current.rotation.z = MathUtils.damp(leftLeg.current.rotation.z, leftZ, 8, delta)
      rightLeg.current.rotation.z = MathUtils.damp(rightLeg.current.rotation.z, rightZ, 8, delta)
    }
  })

  return (
    <group ref={motion}>
      <group>
        <mesh position={[0, 1.66, 0]} scale={[0.71, 0.78, 0.46]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color={metal} metalness={0.66} roughness={0.28} />
        </mesh>

        <mesh position={[0, 1.72, 0.405]} scale={[0.47, 0.52, 0.12]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color={darkMetal} metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.72, 0.47]}>
          <boxGeometry args={[0.58, 0.43, 0.08]} />
          <meshStandardMaterial color="#16304b" metalness={0.35} roughness={0.24} />
        </mesh>
        <ChestEmoji mood={mood} />
        <mesh ref={chestLight} position={[0, 1.43, 0.5]}>
          <sphereGeometry args={[0.045, 16, 12]} />
          <meshStandardMaterial color={gold} emissive={gold} emissiveIntensity={0.6} />
        </mesh>
        {[-0.25, 0.25].map((x) => (
          <mesh key={x} position={[x, 1.43, 0.5]}>
            <sphereGeometry args={[0.045, 16, 12]} />
            <meshStandardMaterial color="#75d5e8" emissive="#2498bb" emissiveIntensity={0.8} />
          </mesh>
        ))}

        <group ref={head} position={[0, 2.77, 0]}>
          <mesh scale={[0.82, 0.68, 0.62]} castShadow>
            <sphereGeometry args={[1, 32, 24]} />
            <meshStandardMaterial color={metal} metalness={0.68} roughness={0.25} />
          </mesh>
          <mesh position={[0, -0.02, 0.49]} scale={[0.68, 0.39, 0.15]}>
            <sphereGeometry args={[1, 32, 24]} />
            <meshStandardMaterial color="#16304b" metalness={0.3} roughness={0.22} />
          </mesh>
          {[-0.26, 0.26].map((x) => (
            <group key={x} position={[x, 0.045, 0.615]}>
              <mesh>
                <sphereGeometry args={[0.105, 24, 16]} />
                <meshStandardMaterial
                  color="#a9f2ff"
                  emissive="#38c8ef"
                  emissiveIntensity={2}
                  toneMapped={false}
                />
              </mesh>
              <mesh position={[0.025, -0.025, 0.07]} scale={[0.025, 0.025, 0.015]}>
                <sphereGeometry args={[1, 12, 8]} />
                <meshBasicMaterial color="white" />
              </mesh>
            </group>
          ))}
          <mesh ref={mouth} position={[0, -0.22, 0.625]} scale={[0.14, 0.045, 0.035]} visible={false}>
            <sphereGeometry args={[1, 20, 12]} />
            <meshStandardMaterial color="#f28d7c" emissive="#9c3028" emissiveIntensity={0.45} />
          </mesh>

          <mesh position={[0, 0.67, 0]} castShadow>
            <cylinderGeometry args={[0.045, 0.055, 0.22, 16]} />
            <meshStandardMaterial color={darkMetal} metalness={0.7} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.81, 0]} castShadow>
            <sphereGeometry args={[0.11, 20, 16]} />
            <meshStandardMaterial
              color={gold}
              emissive={gold}
              emissiveIntensity={1.3}
              toneMapped={false}
            />
          </mesh>
          {[-0.83, 0.83].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.16, 0.045, 10, 24]} />
              <meshStandardMaterial color={gold} metalness={0.55} roughness={0.28} />
            </mesh>
          ))}
        </group>

        <Arm side={-1} armRef={leftArm} />
        <Arm side={1} armRef={rightArm} />
        <Leg side={-1} legRef={leftLeg} />
        <Leg side={1} legRef={rightLeg} />
      </group>
    </group>
  )
}
