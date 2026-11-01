import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

gsap.registerPlugin(ScrollTrigger)

const EASE = 'expo.out'
export const prefersStill = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

let lenis: Lenis | null = null

/** Weighted wheel scrolling. Touch keeps the device's native scroll. */
export function useSmoothScroll() {
  useEffect(() => {
    if (prefersStill()) return
    const instance = new Lenis({ lerp: 0.09 })
    lenis = instance
    instance.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => instance.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tick)
      instance.destroy()
      lenis = null
    }
  }, [])
}

export function scrollToElement(target: HTMLElement | null) {
  if (!target) return
  if (lenis) lenis.scrollTo(target, { duration: 1.4 })
  else target.scrollIntoView()
}

export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true })
  else window.scrollTo(0, 0)
}

/** A line of text that rises from behind a mask when it enters the viewport. */
export function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={className ? `mask ${className}` : 'mask'}>
      <span data-rise>{children}</span>
    </span>
  )
}

/**
 * Entrance choreography for everything under the returned ref:
 * [data-rise] rises from a mask, [data-fade] lifts in, [data-rule] draws across,
 * [data-grow] grows from its baseline.
 */
export function useReveals<T extends HTMLElement>(): RefObject<T | null> {
  const root = useRef<T>(null)
  useLayoutEffect(() => {
    if (!root.current || prefersStill()) return
    const context = gsap.context(() => {
      const once = (el: Element, start = 'top 92%') => ({ trigger: el, start, once: true })
      gsap.utils.toArray<HTMLElement>('[data-rise]').forEach((el) => {
        gsap.from(el, { yPercent: 112, duration: 1.15, ease: EASE, clearProps: 'transform', scrollTrigger: once(el.parentElement!) })
      })
      gsap.utils.toArray<HTMLElement>('[data-fade]').forEach((el) => {
        gsap.from(el, { y: 22, autoAlpha: 0, duration: 1, ease: EASE, clearProps: 'transform,opacity,visibility', scrollTrigger: once(el) })
      })
      gsap.utils.toArray<HTMLElement>('[data-rule]').forEach((el) => {
        gsap.from(el, { scaleX: 0, transformOrigin: 'left center', duration: 1.3, ease: 'expo.inOut', clearProps: 'transform', scrollTrigger: once(el) })
      })
      gsap.utils.toArray<HTMLElement>('[data-grow]').forEach((el) => {
        gsap.from(el.children, { scaleY: 0, transformOrigin: 'center bottom', duration: 1, ease: EASE, stagger: 0.03, clearProps: 'transform', scrollTrigger: once(el) })
      })
    }, root)
    return () => context.revert()
  }, [])
  return root
}

/** 0..1 progress of a tall section scrolling past a sticky stage, in `steps` increments. */
export function useScrub<T extends HTMLElement>(steps = 240) {
  const ref = useRef<T>(null)
  const [progress, setProgress] = useState(() => (prefersStill() ? 1 : 0))
  useEffect(() => {
    if (!ref.current || prefersStill()) return
    const trigger = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => setProgress(Math.round(self.progress * steps) / steps),
    })
    return () => trigger.kill()
  }, [steps])
  return [ref, progress] as const
}

const GLYPHS = '0123456789/—+×·'

/** Small label that resolves from random glyphs once, the first time it is seen. */
export function Scramble({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || prefersStill()) return
    let frame = 0
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const started = performance.now()
      const step = (time: number) => {
        const done = Math.min(1, (time - started) / 700)
        const solved = Math.floor(done * text.length)
        el.textContent = [...text].map((c, i) => (i < solved ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('')
        if (done < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [text])
  return <span ref={ref}>{text}</span>
}

/** Clock digits; only the changing digit gets a brief fade, so a long session stays calm. */
export function Digits({ value, className }: { value: string; className?: string }) {
  return (
    <span className={className} aria-label={value}>
      {[...value].map((char, i) =>
        char === ':' ? (
          <span key={i} className="digit-colon" aria-hidden="true">
            :
          </span>
        ) : (
          <span key={i} className="digit" aria-hidden="true">
            <span key={char}>{char}</span>
          </span>
        ),
      )}
    </span>
  )
}
