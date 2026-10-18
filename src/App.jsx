import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Robot } from './Robot'

// пока фейковая громкость, потом заменим на AnalyserNode
const fakeVolume = () => (Math.sin(performance.now() / 110) + 1) / 2

const ACTIONS = ['Idle', 'Wave', 'Dance', 'ThumbsUp', 'Yes', 'No', 'Jump']

export default function App() {
  const [action, setAction] = useState('Idle')
  const [talking, setTalking] = useState(false)

  const getVolume = () => (talking ? fakeVolume() : 0)

  return (
    <>
      <Canvas camera={{ position: [0, 2, 8], fov: 45 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <Suspense fallback={null}>
          <Robot getVolume={getVolume} action={action} />
        </Suspense>
        <OrbitControls target={[0, 1.5, 0]} />
      </Canvas>

      <div style={{ position: 'fixed', top: 10, left: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ACTIONS.map((a) => (
          <button key={a} onClick={() => setAction(a)}>{a}</button>
        ))}
        <button onClick={() => setTalking((t) => !t)}>
          {talking ? 'Замолчать' : 'Говорить'}
        </button>
      </div>
    </>
  )
}