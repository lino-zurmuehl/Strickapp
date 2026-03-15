import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'strickapp_state_v1'
const MAX_NOTE_LENGTH = 1000

const DEFAULT_THEME = {
  babyBlue: '#AFC4DE',
  bordeaux: '#6B232B',
  background: '#F4F1EC',
  ink: '#232B36',
}

const makeId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const createProject = (name = 'Projekt 1', label = 'Teil 1') => ({
  id: makeId(),
  name,
  sectionLabel: label,
  mainCounter: 0,
  secondCounter: 0,
  stepSize: 1,
  notes: '',
  timer: {
    elapsedMs: 0,
    running: false,
    startedAt: null,
  },
  history: [],
})

const createInitialState = () => {
  const project = createProject()
  return {
    selectedProjectId: project.id,
    projects: [project],
    voiceEnabled: false,
  }
}

const pushHistory = (project, action) => ({
  ...project,
  history: [...project.history, action].slice(-25),
})

const parseStoredState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialState()
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.projects) || !parsed.projects.length) {
      return createInitialState()
    }

    const projects = parsed.projects.map((project, index) => ({
      id: project.id || `legacy-${index}`,
      name: project.name || `Projekt ${index + 1}`,
      sectionLabel: project.sectionLabel || 'Teil 1',
      mainCounter: Number.isFinite(project.mainCounter) ? project.mainCounter : 0,
      secondCounter: Number.isFinite(project.secondCounter) ? project.secondCounter : 0,
      stepSize: Number.isFinite(project.stepSize) ? Math.max(1, project.stepSize) : 1,
      notes: typeof project.notes === 'string' ? project.notes.slice(0, MAX_NOTE_LENGTH) : '',
      timer: {
        elapsedMs: Number.isFinite(project.timer?.elapsedMs) ? project.timer.elapsedMs : 0,
        running: Boolean(project.timer?.running),
        startedAt: Number.isFinite(project.timer?.startedAt) ? project.timer.startedAt : null,
      },
      history: Array.isArray(project.history) ? project.history.slice(-25) : [],
    }))

    const selectedProjectId =
      projects.some((project) => project.id === parsed.selectedProjectId)
        ? parsed.selectedProjectId
        : projects[0].id

    return {
      selectedProjectId,
      projects,
      voiceEnabled: Boolean(parsed.voiceEnabled),
    }
  } catch {
    return createInitialState()
  }
}

const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':')
}

const clampStep = (value) => {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(999, Math.floor(value)))
}

const wordsToNumber = (text) => {
  const clean = text.toLowerCase().trim()
  const direct = Number(clean)
  if (Number.isInteger(direct)) return direct

  const map = {
    null: 0,
    eins: 1,
    ein: 1,
    eine: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    funf: 5,
    fuenf: 5,
    'fünf': 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
  }

  return map[clean] ?? null
}

const getVoiceCommand = (phrase) => {
  const compact = phrase.toLowerCase().replace(/\s+/g, '')
  const signedNumber = compact.match(/^([+-])(\d+)$/)
  if (signedNumber) {
    const [, sign, amountRaw] = signedNumber
    const amount = Number(amountRaw)
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: 'counter',
        direction: sign === '+' ? 'up' : 'down',
        target: 'main',
        amount,
      }
    }
  }

  const normalized = phrase
    .toLowerCase()
    .replace(/[^a-z0-9äöüß+\-\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const simplePlus = normalized.match(/^(?:\+|plus)\s*(\d+)$/)
  if (simplePlus) {
    return {
      type: 'counter',
      direction: 'up',
      target: 'main',
      amount: Number(simplePlus[1]),
    }
  }

  const simpleMinus = normalized.match(/^(?:-|minus)\s*(\d+)$/)
  if (simpleMinus) {
    return {
      type: 'counter',
      direction: 'down',
      target: 'main',
      amount: Number(simpleMinus[1]),
    }
  }

  const plusMatch = normalized.match(/(?:plus|hoch(?:zählen|zahlen)?|erhöhen)(?:\s+(\S+))?/) ||
    normalized.match(/(?:hauptzähler|hauptzahler)\s+plus(?:\s+(\S+))?/) ||
    normalized.match(/(?:nebenzähler|nebenzahler)\s+plus(?:\s+(\S+))?/) ||
    normalized.match(/(?:plus)(?:\s+(\S+))?\s+(?:im|beim)\s+(hauptzähler|hauptzahler|nebenzähler|nebenzahler)/)

  if (plusMatch) {
    const target = normalized.includes('nebenzähler') || normalized.includes('nebenzahler') ? 'second' : 'main'
    const amount = wordsToNumber(plusMatch[1] || '1') ?? 1
    return { type: 'counter', direction: 'up', target, amount }
  }

  const minusMatch = normalized.match(/(?:minus|runter(?:zählen|zahlen)?|verringern)(?:\s+(\S+))?/) ||
    normalized.match(/(?:hauptzähler|hauptzahler)\s+minus(?:\s+(\S+))?/) ||
    normalized.match(/(?:nebenzähler|nebenzahler)\s+minus(?:\s+(\S+))?/) ||
    normalized.match(/(?:minus)(?:\s+(\S+))?\s+(?:im|beim)\s+(hauptzähler|hauptzahler|nebenzähler|nebenzahler)/)

  if (minusMatch) {
    const target = normalized.includes('nebenzähler') || normalized.includes('nebenzahler') ? 'second' : 'main'
    const amount = wordsToNumber(minusMatch[1] || '1') ?? 1
    return { type: 'counter', direction: 'down', target, amount }
  }

  if (normalized.includes('zurücksetzen') || normalized.includes('null')) {
    if (normalized.includes('timer')) return { type: 'timer', action: 'reset' }
    if (normalized.includes('nebenzähler') || normalized.includes('nebenzahler')) {
      return { type: 'counter-reset', target: 'second' }
    }
    return { type: 'counter-reset', target: 'main' }
  }

  if (normalized.includes('zurück') || normalized.includes('undo')) {
    return { type: 'undo' }
  }

  if (normalized.includes('timer starten') || normalized.includes('stoppuhr starten')) {
    return { type: 'timer', action: 'start' }
  }

  if (normalized.includes('timer stoppen') || normalized.includes('timer pausieren') || normalized.includes('stoppuhr stoppen')) {
    return { type: 'timer', action: 'pause' }
  }

  return null
}

function App() {
  const [state, setState] = useState(() => parseStoredState())
  const [voiceStatus, setVoiceStatus] = useState('Sprachsteuerung ist aus.')
  const [timerNow, setTimerNow] = useState(0)

  const recognitionRef = useRef(null)

  const selectedProject = useMemo(
    () => state.projects.find((project) => project.id === state.selectedProjectId) ?? state.projects[0],
    [state.projects, state.selectedProjectId],
  )

  const speechSupported = typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage errors; app should remain usable.
    }
  }, [state])

  useEffect(() => {
    const id = window.setInterval(() => {
      setTimerNow(Date.now())
    }, 250)

    return () => window.clearInterval(id)
  }, [])

  const updateProject = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((project) =>
        project.id === prev.selectedProjectId ? updater(project) : project,
      ),
    }))
  }, [])

  const applyCounterChange = useCallback((target, delta) => {
    updateProject((project) => {
      const key = target === 'main' ? 'mainCounter' : 'secondCounter'
      return pushHistory(
        {
          ...project,
          [key]: Math.max(0, project[key] + delta),
        },
        { type: 'counter', target, delta },
      )
    })
  }, [updateProject])

  const handleUndo = useCallback(() => {
    updateProject((project) => {
      const last = project.history[project.history.length - 1]
      if (!last) return project

      const nextHistory = project.history.slice(0, -1)

      if (last.type === 'counter') {
        const key = last.target === 'main' ? 'mainCounter' : 'secondCounter'
        return {
          ...project,
          [key]: Math.max(0, project[key] - last.delta),
          history: nextHistory,
        }
      }

      if (last.type === 'timer') {
        return {
          ...project,
          timer: {
            elapsedMs: last.previous.elapsedMs,
            running: last.previous.running,
            startedAt: last.previous.startedAt,
          },
          history: nextHistory,
        }
      }

      return {
        ...project,
        history: nextHistory,
      }
    })
  }, [updateProject])

  const updateTimer = useCallback((action) => {
    updateProject((project) => {
      const now = Date.now()
      const previous = { ...project.timer }

      if (action === 'start' && !project.timer.running) {
        return pushHistory(
          {
            ...project,
            timer: {
              ...project.timer,
              running: true,
              startedAt: now,
            },
          },
          { type: 'timer', previous },
        )
      }

      if (action === 'pause' && project.timer.running && project.timer.startedAt) {
        return pushHistory(
          {
            ...project,
            timer: {
              elapsedMs: project.timer.elapsedMs + (now - project.timer.startedAt),
              running: false,
              startedAt: null,
            },
          },
          { type: 'timer', previous },
        )
      }

      if (action === 'reset') {
        return pushHistory(
          {
            ...project,
            timer: {
              elapsedMs: 0,
              running: false,
              startedAt: null,
            },
          },
          { type: 'timer', previous },
        )
      }

      return project
    })
  }, [updateProject])

  const applyVoiceCommand = useCallback((command) => {
    if (command.type === 'counter') {
      const sign = command.direction === 'up' ? 1 : -1
      applyCounterChange(command.target, sign * Math.max(1, command.amount))
      return
    }

    if (command.type === 'counter-reset') {
      updateProject((project) => {
        const key = command.target === 'main' ? 'mainCounter' : 'secondCounter'
        return pushHistory(
          { ...project, [key]: 0 },
          { type: 'counter', target: command.target, delta: project[key] },
        )
      })
      return
    }

    if (command.type === 'timer') {
      updateTimer(command.action)
      return
    }

    if (command.type === 'undo') {
      handleUndo()
    }
  }, [applyCounterChange, handleUndo, updateProject, updateTimer])

  useEffect(() => {
    if (!speechSupported || !state.voiceEnabled) {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
      return
    }

    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new RecognitionCtor()
    recognition.lang = 'de-DE'
    recognition.continuous = true
    recognition.interimResults = false

    recognition.onstart = () => {
      setVoiceStatus('Mikrofon aktiv. Sage z. B. "plus eins" oder "timer starten".')
    }

    recognition.onerror = (event) => {
      setVoiceStatus(`Sprachfehler: ${event.error}.`)
    }

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1]
      if (!last?.isFinal) return
      const transcript = last[0]?.transcript?.trim()
      if (!transcript) return
      const command = getVoiceCommand(transcript)
      if (!command) {
        setVoiceStatus(`Nicht erkannt: "${transcript}"`)
        return
      }
      setVoiceStatus(`Erkannt: "${transcript}"`)
      applyVoiceCommand(command)
    }

    recognition.onend = () => {
      if (state.voiceEnabled) {
        recognition.start()
      }
    }

    recognition.start()
    recognitionRef.current = recognition

    return () => {
      recognition.onend = null
      recognition.stop()
    }
  }, [applyVoiceCommand, speechSupported, state.voiceEnabled])

  const currentElapsed = useMemo(() => {
    if (!selectedProject) return 0
    if (!selectedProject.timer.running || !selectedProject.timer.startedAt) {
      return selectedProject.timer.elapsedMs
    }

    return selectedProject.timer.elapsedMs + (timerNow - selectedProject.timer.startedAt)
  }, [selectedProject, timerNow])

  const addProject = () => {
    const project = createProject(`Projekt ${state.projects.length + 1}`, `Teil ${state.projects.length + 1}`)
    setState((prev) => ({
      ...prev,
      projects: [...prev.projects, project],
      selectedProjectId: project.id,
    }))
  }

  const deleteProject = () => {
    if (state.projects.length <= 1) {
      window.alert('Mindestens ein Projekt muss erhalten bleiben.')
      return
    }

    if (!window.confirm('Projekt wirklich löschen?')) return

    setState((prev) => {
      const remaining = prev.projects.filter((project) => project.id !== prev.selectedProjectId)
      return {
        ...prev,
        projects: remaining,
        selectedProjectId: remaining[0]?.id,
      }
    })
  }

  const resetCounter = (target) => {
    const label = target === 'main' ? 'Hauptzähler' : 'Nebenzähler'
    if (!window.confirm(`${label} zurücksetzen?`)) return

    updateProject((project) => {
      const key = target === 'main' ? 'mainCounter' : 'secondCounter'
      return pushHistory(
        { ...project, [key]: 0 },
        { type: 'counter', target, delta: project[key] },
      )
    })
  }

  if (!selectedProject) {
    return <main className="app-shell">Fehler beim Laden der Projekte.</main>
  }

  return (
    <main
      className="app-shell"
      style={{
        '--baby-blue': DEFAULT_THEME.babyBlue,
        '--bordeaux': DEFAULT_THEME.bordeaux,
        '--bg': DEFAULT_THEME.background,
        '--ink': DEFAULT_THEME.ink,
      }}
    >
      <section className="counter-card main">
        <div className="counter-head">
          <span>Hauptzähler</span>
          <button type="button" className="link-btn" onClick={() => resetCounter('main')}>Zurücksetzen</button>
        </div>
        <button
          className="count-display"
          type="button"
          onClick={() => {
            const raw = window.prompt('Neuer Wert für Hauptzähler:', String(selectedProject.mainCounter))
            if (raw === null) return
            const parsed = Number(raw)
            if (!Number.isFinite(parsed) || parsed < 0) return
            updateProject((project) => ({ ...project, mainCounter: Math.floor(parsed) }))
          }}
          aria-label="Hauptzähler manuell setzen"
        >
          {selectedProject.mainCounter}
        </button>

        <div className="counter-actions">
          <button type="button" onClick={() => applyCounterChange('main', -selectedProject.stepSize)} className="round-btn">−</button>
          <button type="button" onClick={() => applyCounterChange('main', selectedProject.stepSize)} className="round-btn plus">+</button>
        </div>
      </section>

      <section className="counter-card secondary">
        <div className="counter-head">
          <span>Nebenzähler</span>
          <button type="button" className="link-btn" onClick={() => resetCounter('second')}>Zurücksetzen</button>
        </div>

        <div className="secondary-row">
          <button
            className="mini-count"
            type="button"
            onClick={() => {
              const raw = window.prompt('Neuer Wert für Nebenzähler:', String(selectedProject.secondCounter))
              if (raw === null) return
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed < 0) return
              updateProject((project) => ({ ...project, secondCounter: Math.floor(parsed) }))
            }}
          >
            {selectedProject.secondCounter}
          </button>

          <div className="counter-actions compact">
            <button type="button" onClick={() => applyCounterChange('second', -1)} className="round-btn small">−</button>
            <button type="button" onClick={() => applyCounterChange('second', 1)} className="round-btn small plus">+</button>
          </div>
        </div>
      </section>

      <section className="voice-card top-voice">
        <div className="voice-head">
          <h2>Sprachsteuerung (Deutsch)</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={state.voiceEnabled}
              disabled={!speechSupported}
              onChange={(event) => setState((prev) => ({ ...prev, voiceEnabled: event.target.checked }))}
            />
            <span>{state.voiceEnabled ? 'An' : 'Aus'}</span>
          </label>
        </div>
        {!speechSupported ? (
          <p className="voice-warning">
            Diese Safari-Version unterstützt keine Spracherkennung. Alle Funktionen bleiben per Tippen nutzbar.
          </p>
        ) : (
          <>
            <p>{voiceStatus}</p>
            <p className="voice-help">
              Beispiele: "plus eins", "minus eins", "nebenzähler plus zwei", "timer starten", "timer stoppen", "zurück".
            </p>
          </>
        )}
      </section>

      <section className="tools-row">
        <label className="step-control">
          Schrittweite
          <input
            type="number"
            min="1"
            max="999"
            value={selectedProject.stepSize}
            onChange={(event) => {
              const value = clampStep(Number(event.target.value))
              updateProject((project) => ({ ...project, stepSize: value }))
            }}
          />
        </label>

        <button type="button" className="small-btn" onClick={handleUndo}>Undo</button>
      </section>

      <section className="timer-card">
        <div className="counter-head">
          <span>Stoppuhr</span>
          <button type="button" className="link-btn" onClick={() => updateTimer('reset')}>Reset</button>
        </div>
        <p className="time-value">{formatDuration(currentElapsed)}</p>
        <div className="timer-controls">
          {selectedProject.timer.running ? (
            <button type="button" className="small-btn" onClick={() => updateTimer('pause')}>Pause</button>
          ) : (
            <button type="button" className="small-btn" onClick={() => updateTimer('start')}>Start</button>
          )}
          <button type="button" className="small-btn" onClick={() => updateTimer('reset')}>Zurück</button>
        </div>
      </section>

      <section className="notes-card">
        <label htmlFor="notes">Notizen</label>
        <textarea
          id="notes"
          value={selectedProject.notes}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(event) => {
            const notes = event.target.value.slice(0, MAX_NOTE_LENGTH)
            updateProject((project) => ({ ...project, notes }))
          }}
          placeholder="Schönes Muster..."
        />
        <small>{selectedProject.notes.length}/{MAX_NOTE_LENGTH}</small>
      </section>

      <section className="project-card">
        <div className="project-switcher">
          <select
            value={state.selectedProjectId}
            onChange={(event) => setState((prev) => ({ ...prev, selectedProjectId: event.target.value }))}
          >
            {state.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={addProject} className="small-btn">+ Projekt</button>
          <button type="button" onClick={deleteProject} className="small-btn danger">Löschen</button>
        </div>

        <div className="project-meta">
          <input
            key={`name-${selectedProject.id}`}
            type="text"
            defaultValue={selectedProject.name}
            onBlur={(event) => {
              const value = event.target.value.trim()
              updateProject((project) => ({
                ...project,
                name: value || project.name,
              }))
            }}
            placeholder="Projektname"
            maxLength={60}
          />
          <input
            key={`label-${selectedProject.id}`}
            type="text"
            defaultValue={selectedProject.sectionLabel}
            onBlur={(event) => {
              const value = event.target.value.trim()
              updateProject((project) => ({
                ...project,
                sectionLabel: value || project.sectionLabel,
              }))
            }}
            placeholder="Teil / Bereich"
            maxLength={60}
          />
        </div>
      </section>
    </main>
  )
}

export default App
