import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Robot } from './Robot'
import TamadaVoice from './tamadaVoice'

// Фейковая громкость для рта
const fakeVolume = () => (Math.sin(performance.now() / 110) + 1) / 2

const ACTIONS = ['Idle', 'Wave', 'Dance', 'ThumbsUp', 'Yes', 'No', 'Jump']

function actionFromCommand(message) {
  const text = message.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim()

  if (
    /стоп|хватит|перестань|успокойся|стой/u.test(text) ||
    /не\s+(?:надо\s+)?(?:танц|прыга|маш|кива|покач)/u.test(text)
  ) {
    return 'Idle'
  }
  if (/танцевать|танцуй|потанцуй|потанцуем|устроим\s+танцы|дискотек/u.test(text)) {
    return 'Dance'
  }
  if (/помаш|помах|поприветств|поздоров|приветствуй/u.test(text)) return 'Wave'
  if (/больш(?:ой|ого)\s+палец|лайк|класс|одобр/u.test(text)) return 'ThumbsUp'
  if (/кивни|кивай|кивок|согласись|подтверди|скажи\s+да/u.test(text) || text === 'да') {
    return 'Yes'
  }
  if (
    /покачай\s+головой|покачать\s+головой|покачни|скажи\s+нет/u.test(text) ||
    text === 'нет'
  ) {
    return 'No'
  }
  if (/прыгни|прыгай|прыжок/u.test(text)) return 'Jump'
  if (text === 'idle') return 'Idle'
  return null
}

export default function App() {
  const [action, setAction] = useState('Idle')
  const [talking, setTalking] = useState(false) // Сюда TamadaVoice будет передавать true/false
  const [musicError, setMusicError] = useState('')
  const musicRef = useRef(null)

  const getVolume = () => (talking ? fakeVolume() : 0)
  const selectAction = useCallback((nextAction) => {
    setMusicError('')
    setAction(nextAction)
  }, [])
  const handleUserMessage = useCallback((message) => {
    const command = actionFromCommand(message)
    if (command) selectAction(command)
  }, [selectAction])

  useEffect(() => {
    const music = musicRef.current
    if (!music) return

    if (action !== 'Dance') {
      music.pause()
      music.currentTime = 0
      return
    }

    let cancelled = false
    music.currentTime = 0
    music.play().catch(() => {
      if (!cancelled) {
        setMusicError('Не удалось включить музыку. Нажмите на страницу и попробуйте снова.')
      }
    })

    return () => {
      cancelled = true
      music.pause()
      music.currentTime = 0
    }
  }, [action])

  return (
    <main className="app-layout">
      <audio
        ref={musicRef}
        src="/Jakarta%20-%20One%20Desire%20(Orginal%20version)%20bebe%20tecktonik.mp3"
        loop
        preload="auto"
        volume={1}
      />
      <section className="robot-panel" aria-label="Робот">
        <Canvas camera={{ position: [0, 2, 8], fov: 45 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 4]} intensity={1.5} />
          <Robot getVolume={getVolume} talking={talking} action={action} />
          <OrbitControls target={[0, 1.5, 0]} />
        </Canvas>

        {/* Кнопки управления роботом (можно оставить для тестов) */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ACTIONS.map((a) => (
            <button key={a} onClick={() => selectAction(a)}>{a}</button>
          ))}
        </div>
        {musicError && (
          <p
            role="alert"
            style={{ position: 'absolute', left: 10, bottom: action === 'Dance' ? 48 : 10, color: '#ffd9de' }}
          >
            {musicError}
          </p>
        )}
      </section>

      <aside className="voice-panel">
        <TamadaVoice onSpeakingChange={setTalking} onUserMessage={handleUserMessage} />
      </aside>
    </main>
  )
}