import { useLayoutEffect, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

export function AutoExpandingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const resize = () => {
      element.style.height = 'auto'
      element.style.height = `${Math.min(element.scrollHeight + 2, 160)}px`
      element.style.overflowY = element.scrollHeight > 158 ? 'auto' : 'hidden'
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.value])
  return <textarea {...props} ref={ref} rows={1} className={`auto-expanding-textarea ${props.className ?? ''}`} />
}
