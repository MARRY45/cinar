import { useEffect, useRef, useState } from 'react'
import { prefersStill } from '../motion.tsx'
import { loadPhoto, type EffectId, type Prefs } from '../prefs.ts'

interface Particle {
  x: number
  y: number
  r: number
  v: number
  phase: number
}

const COUNTS: Record<EffectId, number> = { off: 0, motes: 46, stars: 120, rain: 110, bubbles: 28 }

function Effect({ effect }: { effect: EffectId }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || effect === 'off') return
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)
    const particles: Particle[] = Array.from({ length: COUNTS[effect] }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random(),
      v: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
    }))
    const color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    let frame = 0
    let last = performance.now()

    const draw = (time: number) => {
      const dt = Math.min(60, time - last) / 1000
      last = time
      const { width: w, height: h } = canvas
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = color
      ctx.strokeStyle = color
      for (const p of particles) {
        if (effect === 'rain') {
          p.y += p.v * dt * 1.4
          if (p.y > 1) p.y -= 1
          ctx.globalAlpha = 0.12 + p.r * 0.16
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p.x * w, p.y * h)
          ctx.lineTo(p.x * w - 2, p.y * h + 10 + p.r * 14)
          ctx.stroke()
        } else if (effect === 'stars') {
          ctx.globalAlpha = 0.14 + 0.4 * (0.5 + 0.5 * Math.sin(time / 1500 + p.phase)) * p.v
          ctx.beginPath()
          ctx.arc(p.x * w, p.y * h, 0.5 + p.r, 0, 7)
          ctx.fill()
        } else if (effect === 'motes') {
          p.y -= p.v * dt * 0.012
          p.x += Math.sin(time / 4000 + p.phase) * dt * 0.006
          if (p.y < 0) p.y += 1
          ctx.globalAlpha = 0.1 + p.r * 0.25
          ctx.beginPath()
          ctx.arc(p.x * w, p.y * h, 0.8 + p.r * 1.6, 0, 7)
          ctx.fill()
        } else {
          p.y -= p.v * dt * 0.035
          if (p.y < -0.05) p.y += 1.1
          ctx.globalAlpha = 0.1 + p.r * 0.14
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc((p.x + Math.sin(time / 3000 + p.phase) * 0.008) * w, p.y * h, 4 + p.r * 16, 0, 7)
          ctx.stroke()
        }
      }
      if (!prefersStill()) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [effect])

  return effect === 'off' ? null : <canvas ref={ref} className="effect-canvas" aria-hidden="true" />
}

export function SceneLayer({ prefs }: { prefs: Prefs }) {
  const [photo, setPhoto] = useState<string | null>(null)

  useEffect(() => {
    if (prefs.scene !== 'photo') return
    let url: string | null = null
    loadPhoto()
      .then((blob) => {
        if (blob) {
          url = URL.createObjectURL(blob)
          setPhoto(url)
        }
      })
      .catch(() => setPhoto(null))
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [prefs.scene, prefs.photoRev])

  const image = prefs.scene === 'none' ? null : prefs.scene === 'photo' ? photo : `/scenes/${prefs.scene}.webp`

  return (
    <>
      {image && <div className="scene-layer" style={{ backgroundImage: `url(${image})` }} aria-hidden="true" />}
      <Effect effect={prefs.effect} />
    </>
  )
}
