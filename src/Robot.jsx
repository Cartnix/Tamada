import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'

export function Robot({ getVolume, action = 'Idle' }) {
  const group = useRef()
  const faces = useRef([])
  const { scene, animations } = useGLTF('/RobotExpressive.glb')
  const { actions } = useAnimations(animations, group)

  useEffect(() => {
    faces.current = []
    scene.traverse((o) => {
      if (o.morphTargetDictionary) {
        faces.current.push(o)
        console.log('МОРФЫ:', o.name, o.morphTargetDictionary)
      }
    })
    console.log('АНИМАЦИИ:', Object.keys(actions))
  }, [scene, actions])

  useEffect(() => {
    const a = actions[action]
    a?.reset().fadeIn(0.3).play()
    return () => {
      a?.fadeOut(0.3)
    }
  }, [action, actions])

  useFrame(() => {
    const v = getVolume()
    faces.current.forEach((m) => {
      const i = m.morphTargetDictionary['Surprised']
      if (i !== undefined) {
        m.morphTargetInfluences[i] = Math.min(1, v * 1.5)
      }
    })
  })

  return <primitive ref={group} object={scene} />
}

useGLTF.preload('/RobotExpressive.glb')